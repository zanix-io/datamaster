# Dead Letter Queue (DLQ)

A Mongo-backed registry of items that failed in some business process — payments, webhooks, jobs,
any operation your app wants to record, inspect, and retry — for auditing, debugging, and manual or
programmatic reprocessing.

This is **not** `@zanix/asyncmq`'s own dead-letter mechanism
(`ZanixAsyncMQProvider.requeueDeadLetters`), which is RabbitMQ-native (messages the broker itself
moved to a `.dlq` queue after exhausting delivery retries). `DLQProvider` is broker-agnostic
persistence: useful even in apps that never touch a message queue at all. Don't confuse the two when
looking for "why did my message end up here" — a broker-level delivery failure and an
application-level DLQ entry are different concepts, tracked in different places.

```ts
// src/server/dlq.defs.ts — auto-discovered by @zanix/core's own bootstrap, same convention as any
// other model.defs.ts. Not something you call from main.ts, and not part of Zanix.setup(): setup()
// only ever sets env vars (see "Configuration" below); registerDLQModel() is a real registration,
// same as registerModel() itself.
import { registerDLQModel } from 'jsr:@zanix/datamaster@[version]'

registerDLQModel()
```

`DLQProvider` is registered under the `'dlq'` core-provider slot — resolve it exactly like any other
provider, from any `ZanixInteractor`/`ZanixProvider`:

```ts
const dlq = this.providers.get(DLQProvider) // or this.providers.get('dlq')

await dlq.push({
  processType: 'payment.process',
  origin: 'orders-service',
  payload: { orderId: 'abc123' },
  error: { name: 'PaymentGatewayError', message: 'timeout' },
  maxAttempts: 3,
})
```

## Lifecycle

```
pending ──claim()──> claimed ──complete()──> completed
   ▲                    │
   │                 fail() (attempts < maxAttempts)
   └────────────────────┘
                         │
                      fail() (attempts >= maxAttempts)
                         ▼
                      failed ──requeue()──> pending
```

- **`push(input)`** — records a new failed item. Always starts `'pending'`, `attempts: 0`.
- **`get(id)`** / **`list(options?)`** — point lookup / filtered, paginated query (delegates to the
  shared `paginate` static — no bespoke pagination logic). `list()` also accepts a raw `filter`
  passthrough for querying into `payload`/`metadata` sub-fields — see "Data model" below.
- **`claim(options)`** — atomically reserves one eligible entry for processing (see "Concurrency"
  below). Returns `null` when nothing is eligible — never throws for "nothing to claim."
- **`release(id, { leaseOwner })`** — gives up a claim early (e.g. on consumer shutdown), without
  waiting out the lease TTL.
- **`complete(id, { leaseOwner })`** — marks a claimed entry as successfully processed (terminal).
- **`fail(id, { leaseOwner, error })`** — records a new failure. Moves back to `'pending'` if
  `attempts < maxAttempts`, or to `'failed'` otherwise.
- **`requeue(id, options?)`** — administrative retry, forcing an entry back to `'pending'`
  regardless of `maxAttempts` (e.g. after a `'failed'` entry's root cause is fixed).
  `resetAttempts: true` also zeroes `attempts`.
- **`discard(id, options?)`** — permanent logical close, distinct from deletion — the record stays
  for audit.
- **`remove(id)`** — physical delete, for retention/cleanup. Always manual in this version; no
  TTL/auto-purge.

`release`/`complete`/`fail` all require a matching `leaseOwner` and throw `HttpError('CONFLICT')`
otherwise — never a silent no-op or an accidental overwrite of another claimant's work.

## Concurrency: `claim()`, not static worker slots

Multiple app instances can safely call `claim()` against the same collection without any static
partitioning (`"worker-1"`, `"worker-2"`, ...) or an external lock service. The primitive is Mongo's
own atomic `findOneAndUpdate`: two concurrent `claim()` calls can never both succeed against the
same document, at the storage-engine level, with zero extra infrastructure.

```ts
const leaseOwner = `worker:${crypto.randomUUID()}` // any free-form identifier — not a reserved "slot"
const entry = await dlq.claim({ leaseOwner, leaseTtlMs: 30_000 }) // TTL defaults to DLQ_DEFAULT_LEASE_MS, then 30s
if (!entry) return // nothing eligible right now

try {
  await reprocess(entry)
  await dlq.complete(entry._id, { leaseOwner })
} catch (error) {
  await dlq.fail(entry._id, { leaseOwner, error })
}
```

An entry becomes claimable again either because it's genuinely `'pending'`, or because it's
`'claimed'` with an **expired lease** — the abandoned-worker case (a process crashed mid-processing
without calling `release()`/`complete()`/`fail()`). `leaseOwner` is a free-form label with no
partitioning semantics `DLQProvider` enforces — encode any convention you like in the string (e.g.
`asyncmq:pod-3`) if you need one; the provider itself never interprets it.

**Known limitation**: a `complete()`/`fail()`/`release()` call is fenced by `leaseOwner` matching,
but not by whether the lease is _still_ the same lease instance — if a claim's lease expires and
nobody has reclaimed it yet, a very late `complete()` from the original holder still succeeds. This
is the standard "at-least-once, no synchronized clocks" trade-off of TTL-based leases; keep
`leaseTtlMs` comfortably longer than your actual processing time to make this scenario rare in
practice.

## Data model

```ts
type DLQEntryAttrs = {
  _id: string
  processType: string // e.g. 'payment.process'
  origin: string // service/package that originated the failure
  processId?: string // correlation id (job id, trace id) for debugging
  payload: unknown // the original failed payload, any shape
  error: { name: string; message: string; stack?: string } // most recent error
  errorHistory: Array<
    {
      name: string
      message: string
      stack?: string
      occurredAt: Date
      attempt: number
    }
  >
  attempts: number
  maxAttempts?: number
  status: 'pending' | 'claimed' | 'failed' | 'completed' | 'discarded'
  leaseOwner?: string
  leaseExpiresAt?: Date
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}
```

`payload` is a native, queryable `Mixed` field by default — filter into it via `list()`'s `filter`
passthrough:

```ts
await dlq.list({ filter: { 'payload.orderId': 'abc123' } })
await dlq.list({ filter: { 'payload.customer.tier': 'gold' } })
```

Unindexed: fine for admin/debug lookups, but a hot query path should promote the field to its own
indexed top-level column instead (`processType`/`processId` already exist for the common
"correlation id" case). This queryability goes away when `encryptPayload` is enabled — see
"Protecting the payload" below.

## Protecting the payload

A DLQ payload is, by nature, "whatever failed" — it can carry internal details or PII. Encryption is
**off by default** (forcing it on every consumer, and the key-management it implies, isn't
appropriate for every app) but one option away, reusing the same `encrypt` data-protection mechanism
every other Zanix model uses — no separate mechanism, no new keys:

```ts
registerDLQModel({ encryptPayload: true }) // symmetric (DATA_AES_KEY)
registerDLQModel({ encryptPayload: { type: 'asymmetric' } }) // DATA_RSA_PUB / DATA_RSA_KEY
```

`DLQ_ENCRYPT_PAYLOAD` (`'true'`/`'false'`), if set, always wins over the `encryptPayload` option —
lets an environment force the behavior without a code change.

**This changes the storage shape, not just a flag**: off (default), `payload` is a native `Mixed`
field (see "Data model" above — fully queryable). On, it's stored as a JSON-serialized, encrypted
string instead, and **stops being queryable entirely** — the underlying `encrypt`/`decrypt`
primitives (`utils/protection.ts`) only operate on `string | string[]`, so a `Mixed` field can't use
them directly. `DLQProvider` exposes `payload` as a plain value either way (`push`/`get`/`list`
handle both shapes transparently) — the trade-off only affects what you can `filter` by.

### Protecting only some fields: `payloadFields`

`encryptPayload` is all-or-nothing. To protect just the genuinely sensitive leaves while keeping
everything else queryable, declare `payload`'s own field shape instead — the same
`{ field: { type, get, ... } }` shape `registerModel`'s top-level `definition` already uses, so
individual fields get `dataProtectionGetter`/`dataAccessGetter` exactly like any other model field:

```ts
import { dataProtectionGetter } from 'jsr:@zanix/datamaster@[version]/database'

registerDLQModel({
  payloadFields: {
    orderId: { type: String }, // stays queryable, unprotected
    creditCard: { type: String, get: dataProtectionGetter('encrypt') }, // protected, this leaf only
  },
})

await dlq.push({ payload: { orderId: 'abc123', creditCard: '4111-1111-1111-1111' }, ... })
const entry = await dlq.get(id)
entry.payload.creditCard // '4111-1111-1111-1111' — decrypted back automatically
await dlq.list({ filter: { 'payload.orderId': 'abc123' } }) // still works — orderId was never encrypted
```

Takes priority over `encryptPayload` when both are given. `push`/`get`/`list` handle this exactly
like the whole-payload cases above — you always get plain values back, never a `DecryptableObject`
you have to unwrap yourself; `DLQProvider` reverses every protected path (however deeply nested) via
the same `transformByDataProtection` mechanism the framework already uses elsewhere for
whole-document reads. `payload` stays typed `unknown` either way — declaring `payloadFields` shapes
the _storage schema_, not the TypeScript type `push()`/`get()` see.

**Encryption fails open**: if the corresponding key env var (`DATA_AES_KEY`, `DATA_RSA_PUB`/
`DATA_RSA_KEY`) isn't set, the payload is stored **unencrypted**, silently — this is the underlying
data-protection mechanism's existing behavior (see [Data Protection](./DATA-PROTECTION.md)), not
something specific to DLQ. Enabling `encryptPayload` without the matching key configured gives a
false sense of security — verify the key is actually present in every environment where this
matters.

**Even with encryption on, queries never work on the encrypted value itself** — the `encrypt`
strategy uses AES-GCM with a random IV, so identical plaintext produces different ciphertext every
time. Equality/range queries on an encrypted field aren't possible regardless of storage shape; only
the unencrypted structure around it (`processType`, `metadata`, ...) is ever queryable.

**`payloadFields` compiles to one schema shared by every `processType` in the collection** — there
are no discriminators, so a leaf's `get`/type applies identically to every document regardless of
`processType`. Two process types with a same-named field but different protection needs (e.g. a
`payment` entry's `creditCard` should be encrypted, a `webhook` entry's own `creditCard`-named field
shouldn't) can't both bind to a single top-level `creditCard` leaf. Namespace by `processType`
instead — nested objects are still just fields, and Mongoose resolves by full path
(`payload.payment.creditCard` vs. `payload.webhook.creditCard`), so identical leaf names in
different branches never collide:

```ts
registerDLQModel({
  payloadFields: {
    payment: {
      orderId: { type: String },
      creditCard: { type: String, get: dataProtectionGetter('encrypt') }, // protected here...
    },
    webhook: {
      url: { type: String },
      creditCard: { type: String }, // ...but not here — independent path, independent behavior
    },
  },
})

await dlq.push({ processType: 'payment.process', payload: { payment: { orderId: 'x', creditCard: '4111...' } }, ... })
await dlq.push({ processType: 'webhook.process', payload: { webhook: { url: 'https://...', creditCard: 'unrelated-id' } }, ... })
```

Nothing enforces the `processType` ↔ `payloadFields` branch correspondence — it's a convention in
how you shape `payload` on `push()`, not something `DLQProvider` validates.

## Configuration

| Env var                | Default     | Also settable via                                                                            |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `DLQ_MODEL_NAME`       | `zanix-dlq` | `registerDLQModel({ modelName })`, or `Zanix.setup({ dlq: { modelName } })` (`@zanix/core`)  |
| `DLQ_ENCRYPT_PAYLOAD`  | off         | `registerDLQModel({ encryptPayload })`, overridden by this env var when set                  |
| `DLQ_DEFAULT_LEASE_MS` | `30000`     | `registerDLQModel({ defaultLeaseMs })`, then per-call `claim({ leaseTtlMs })` wins over both |

All three env vars, when set, always win over their matching `registerDLQModel` option — the same
precedence `encryptPayload` already had. `registerDLQModel()` is required regardless (Mongoose needs
a concrete schema before any query against the collection works), but _how_ it's named/tuned can
come from either source: the option when it's convenient to keep next to the rest of the model's own
declaration, or the env var when an environment needs to override it without a code change. Because
`registerDLQModel` is the only place that writes `modelName`/`defaultLeaseMs` for `dlqModelName()`/
`defaultLeaseTtlMs()` to later resolve, there's no risk of the two drifting apart the way a naive
per-call-site cache might.

For a multi-connector app, pass the target connector class as `registerDLQModel`'s second argument —
same convention as `registerModel`'s own `connector` parameter.

## Distributed processing — `@zanix/asyncmq/dlq`

`DLQProvider` is deliberately a **passive store**: it never claims or interprets entries on its own.
Deciding _when_ and _how_ to reprocess belongs to a higher layer — `@zanix/datamaster` never imports
`@zanix/asyncmq` (or knows it exists), so the actual claim/dispatch loop lives entirely in
**`@zanix/asyncmq`**'s own `registerDLQProcessor` (`@zanix/asyncmq/dlq` — a separate subpath, so
importing the rest of `@zanix/asyncmq` never pulls in `@zanix/datamaster`'s module graph for apps
that don't use DLQ at all):

```ts
import { registerDLQProcessor } from 'jsr:@zanix/asyncmq@[version]/dlq'

// Wherever `payment.process` reprocessing logic actually lives — typically your own app's
// dlq.defs.ts, auto-discovered the same way registerDLQModel() is (see above):
registerDLQProcessor('payment.process', {
  name: 'reprocess-payment',
  schedule: '0,30 * * * * *', // every 30s — @zanix/asyncmq's own 6-field cron format
  handler: async function (entry) {
    const payments = this.providers.get(PaymentsRepository)
    await payments.retry(entry.payload)
  },
})
```

`registerDLQProcessor` is a thin, direct wrapper over `@zanix/asyncmq`'s own `registerCronJob` —
each tick it claims one eligible entry for that `processType` (if any), runs your `handler`, and
marks the entry `complete`/`fail` accordingly. `schedule`/`isActive` are `registerCronJob`'s own
real types (`Pick`ed directly, not redeclared), so there's no separate contract to keep in sync.

**Why this lives in `@zanix/asyncmq`, not here or in `@zanix/core`**: earlier revisions of this
design hosted an open registry in `@zanix/datamaster` (mirroring `registerTriggerActionJob`, drained
by `@zanix/core`) — but that pattern exists specifically to solve a _lateral_ dependency problem
(`@zanix/notifications` can't import `@zanix/asyncmq` directly to register its own `mail` job, since
they're peer packages). A DLQ processor doesn't have that problem: it's normally registered by your
own app's code, which can always import `@zanix/asyncmq` directly — so the registry/drain
indirection was solving a problem that didn't actually exist here, at the cost of `schedule` having
to stay a loosely-typed `string` to avoid `@zanix/datamaster` depending on `@zanix/asyncmq`'s
contract. `@zanix/asyncmq` depending downward on `@zanix/datamaster` for `DLQProvider` (to actually
claim/ complete/fail) is a perfectly valid direction — the same one `@zanix/notifications` already
uses for its own persistence.

## See also

- [Configuration](./CONFIGURATION.md) — the full env var reference.
- [Data Protection](./DATA-PROTECTION.md) — the `encrypt`/`mask`/`hash` mechanism `encryptPayload`
  builds on.
- `@zanix/asyncmq`'s `registerDLQProcessor` (`@zanix/asyncmq/dlq`) — distributed processing, above.
