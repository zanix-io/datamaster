# Triggers

Reactive side effects (send an email, fire an HTTP request, run a custom job) tied to a model's
create/update/delete lifecycle, declared as data instead of imperative code.

> ⚠️ **Security: never hardcode secrets in a trigger definition.** A trigger's fields are
> declarative config that can be read back (e.g. via the
> [persisted triggers collection](#persisted-triggers-online-adaptation), a plain document in the
> database) — a literal API key, bearer token, password, or other credential written directly into
> `headers`, `body`, `url`, or any other field is exposed to anyone who can read that config, not
> just whoever executes the trigger. Don't write this:
>
> ```ts
> headers: {
>   authorization: 'Bearer sk_live_xxxxx'
> }
> // or:
> password: 'my-secret-password'
> ```
>
> Instead, reference an environment variable with the `${{VARIABLE_NAME}}` placeholder:
>
> ```ts
> headers: {
>   authorization: 'Bearer ${{API_KEY}}'
> }
> ```
>
> `${{ENV_VAR}}` is resolved automatically from `Deno.env` right before the action executes — **as
> long as that variable is registered in the environment of the application where the trigger (or
> the model/schema that owns it) actually runs**. See
> [Environment variable interpolation](#environment-variable-interpolation-env_var) below.

## Declaring triggers (`extensions.triggers`)

```ts
import { registerModel } from 'jsr:@zanix/datamaster@[version]'

registerModel({
  name: 'users',
  definition: { email: String, active: Boolean },
  extensions: {
    triggers: {
      post: {
        created: [{
          mail: {
            to: '{{email}}',
            subject: 'Welcome {{name}}',
            body: { template: 'welcome', data: { name: '{{name}}' } },
          },
        }],
        updated: [{
          request: {
            url: '${{USER_UPDATED_WEBHOOK_URL}}',
            method: 'POST',
            headers: { authorization: 'Bearer ${{WEBHOOK_TOKEN}}' },
            body: { email: '{{email}}' },
          },
        }],
      },
      pre: {
        deleted: [{
          custom: { name: 'archive-before-delete' },
        }],
      },
    },
  },
})
```

`{{email}}` comes from the model/event context — the record the trigger fired for.
`${{USER_UPDATED_WEBHOOK_URL}}`/`${{WEBHOOK_TOKEN}}` come from `Deno.env` instead, so the webhook
URL and its bearer token never appear as literal text in the trigger definition. Both systems
coexist freely, even within the same field — see
[Environment variable interpolation](#environment-variable-interpolation-env_var) for the full
resolution rules.

`Triggers` is `{ pre?, post? } × { created?, updated?, deleted? } → Array<Partial<TriggerActions>>`
— each event can list several actions, and an action can mix `mail`, `request`, and `custom` on the
same entry (all present ones fire).

**`conditions`/`priority`/`delay`/`data` are independent per action type, never shared** — even when
`mail`, `request`, and `custom` are grouped on the same entry, each reads its own copy of these
fields, not a sibling's. A `custom` action with `conditions` next to a `mail` action with none means
`custom` is conditional and `mail` fires unconditionally, every time:

```ts
const created = [{
  custom: {
    name: 'notify-ops',
    conditions: [{ field: 'plan', op: '=', value: 'enterprise' }], // only custom checks this
  },
  mail: { to: '{{email}}', subject: 'Welcome', body: { template: 'welcome' } }, // always fires
}]
```

To make `mail` conditional too, repeat `conditions` (or whichever common field) on `mail` itself —
grouping actions on one entry versus splitting them into separate array entries makes no difference
to dispatch either way; it's purely a matter of how you want to read the config.

## Trigger actions (`TriggerActions`)

| Action    | Fields                                                    | How it's dispatched                                                                      |
| --------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `mail`    | `to`, `subject`, plus whatever the registered job expects | `DEFAULT_TRIGGER_JOBS.mail`, or a `registerTriggerActionJob('mail', ...)` override       |
| `request` | `url`, `method`, `headers`, `body?`                       | `DEFAULT_TRIGGER_JOBS.request`, or a `registerTriggerActionJob('request', ...)` override |
| `custom`  | `name`                                                    | The job named `name` — one you (or `@zanix/asyncmq`) already registered yourself         |

Datamaster only knows `mail` needs a recipient and a subject — the rest of the payload (e.g. which
template to render, and its data) is interpreted entirely by whichever job actually handles it. See
`@zanix/notifications`'s own docs for the concrete contract its default `mail` handler uses.

**Every string field** on `mail`/`request` (`to`, `subject`, `url`, `headers`' values, `body`'s own
values, ...) supports `{{field}}`/`{{nested.path}}` placeholders, resolved against the record the
trigger fired for. This is the **only** way a field sees per-record data — nothing is merged in
automatically beyond what a field's own placeholders resolve to (see
[Dispatched payload](#dispatched-payload)). The same fields also support `${{ENV_VAR}}`
placeholders, resolved from `Deno.env` — see
[Environment variable interpolation](#environment-variable-interpolation-env_var) below.

- **A field whose entire value is one placeholder** (nothing before or after it, e.g.
  `amount: '{{amount}}'`) resolves to the record's **real value, of whatever type it is** — a
  number, boolean, `Date`, nested object, array, `null`, or `undefined` — not a stringified copy.
  This is what you want for `request.body`/`mail.body` fields that should carry the record's actual
  data type.
- **A field that mixes a placeholder with other text, or has more than one placeholder** (e.g.
  `'key={{key}}'`, a URL's query string `'?value={{value}}'`, `'Bearer {{apiKey}}'`) always
  substitutes each placeholder as a **string**, since the result must remain one string — exactly
  what a query string needs: `url: 'https://x.com?value={{amount}}'` with a numeric `amount`
  produces the real string `'https://x.com?value=42'` HTTP can send. A placeholder resolving to
  `undefined`/`null` becomes `''` in this form.

Beyond `to`/`subject`, `mail` accepts whatever additional fields the job registered for it expects —
datamaster passes them through untyped and uninterpreted. The default job (self-registered by
`@zanix/notifications` when bootstrapped via `@zanix/core`) expects a
`body: { template: string;
data?: Record<string, unknown> | string }` field: `template` names the
notifier template, and `data` is its render data — see `@zanix/notifications`'s own docs
(`MailTriggerActionData`, `sendMailTriggerNotification`) for that contract's full shape. String
values within `data` support `{{field}}` interpolation, same as any other field.

`request.body` is **entirely opt-in** — if you don't set it, no body is sent at all, even though the
trigger fired for a real record. Only the properties you explicitly list (with `{{field}}`
interpolation applied) go out over the wire.

**For `GET`, `HEAD`, and `DELETE`** — methods that conventionally carry no body — a configured
`request.body` is **converted into query parameters** appended to `url` instead of being sent as a
fetch body (many servers ignore or reject a body on these methods, so this is what actually reaches
the endpoint):

```ts
request: {
  url: 'https://api.example.com/users',
  method: 'GET',
  headers: {},
  body: { id: '{{id}}', tags: '{{tags}}' }, // tags: ['a', 'b'] on the record
}
// → GET https://api.example.com/users?id=42&tags=a&tags=b
```

Arrays expand into **repeated keys** (`tags=a&tags=b`) and nested objects use **bracket notation**
(`address[city]=Bogotá`) — the same convention `@zanix/utils`'s `getProcessedParams` parses back
into an object/array, via its `toSearchParams` counterpart. `url` itself supports the same expansion
directly in a query string, for a whole-value placeholder (`'?tags={{tags}}'` with an array field) —
see [Trigger actions](#trigger-actions-triggeractions) above for the whole-vs-partial placeholder
rule that makes this possible. For every other method (`POST`, `PUT`, `PATCH`), `body` is sent as a
real fetch body, JSON-serialized by the consumer-side job.

All three also accept the common fields from `TriggerActionCommons`: `priority`
(`'high'|'medium'|'low'`, defaults to `'low'`), `delay` (forwarded to the job payload), `data`
(extra static data merged into the job's payload, not the same as `request.body` — see below), and
`conditions` (see below).

> ⚠️ **`mail`/`request` need a consumer-side job registered to actually do anything.** Datamaster
> only **dispatches** — via `ProgramModule.providers.get('worker')` (from `@zanix/server`), to
> whichever job `registerTriggerActionJob('mail' | 'request', descriptor)` last registered, falling
> back to `DEFAULT_TRIGGER_JOBS`'s literal names if nothing did. Apps bootstrapped via
> `@zanix/core`'s `Zanix.start()`/`Zanix.startWorker()` get both wired automatically: `request` is
> registered by `@zanix/core` itself (generic `fetch`, no other owner); `mail` is self-registered by
> `@zanix/notifications`'s own `/core` entrypoint, since it owns `NotifierProvider`'s contract.
> `@zanix/core` drains every descriptor registered this way and performs the actual `@zanix/asyncmq`
> `registerJob` call — the one place that happens, so a package registering its own trigger-action
> job never needs to depend on `@zanix/asyncmq` itself. A `custom` action works end-to-end today as
> long as you've registered that job name yourself via `@zanix/asyncmq`'s `registerJob` — the same
> job a `this.worker.runJob(name, ...)` call from an interactor would target.
>
> Dispatch itself picks `runJob` (queue-backed) when `AMQP_URI` is configured, or falls back to
> `runTask` (local, in-process) when it isn't — there's no queue to publish to in that case, the
> same way [Cache](./CACHE.md) only registers the Redis connector when `REDIS_URI` is set.

## Environment variable interpolation (`${{ENV_VAR}}`)

Any string field that supports `{{field}}` interpolation also supports a second, independent
placeholder convention — `${{VARIABLE_NAME}}` — resolved from `Deno.env` instead of the record. This
is the mechanism the security warning at the top of this document relies on: it lets a trigger reach
a secret (an API key, a bearer token, a webhook URL) without writing it into the trigger definition
itself.

```ts
headers: {
  authorization: 'Bearer ${{API_KEY}}'
}
```

resolves, given `API_KEY=my-secret-key` in the environment, to:

```ts
headers: {
  authorization: 'Bearer my-secret-key'
}
```

**Resolution rules:**

- Every `${{VARIABLE_NAME}}` occurrence is replaced with `Deno.env.get('VARIABLE_NAME')`'s value —
  this works for a whole-value field (`token: '${{API_TOKEN}}'`), a value mixed with other text
  (`'Bearer ${{API_TOKEN}}'`), and a string with multiple placeholders
  (`'${{HOST}}/${{PATH}}/${{TOKEN}}'`).
- **If the variable isn't registered**, `Deno.env.get` returns `undefined`, which is substituted as
  the literal text `'undefined'` — e.g. `'Bearer ${{MISSING}}'` becomes `'Bearer undefined'`. This
  **never throws**: a missing variable fails loudly and visibly in the dispatched payload, instead
  of silently or by crashing the trigger.
- The variable must be registered **in the environment of the application where the trigger (or the
  model/schema that owns it) actually runs** — not just wherever the trigger was authored. A worker
  process dispatching `runJob`/`runTask` needs the same variable set in its own environment.
- Nested objects and arrays are walked recursively, exactly like `{{field}}` interpolation — this
  works in `headers`, `body`, `url`, and any other field, for `mail`, `request`, and any future
  action type. It isn't request-specific.
- **`{{field}}` and `${{ENV_VAR}}` are fully independent and can coexist** in the same string or the
  same object — resolving one never touches the other's placeholders:

  ```ts
  request: {
    url: '${{USER_UPDATED_WEBHOOK_URL}}',
    method: 'POST',
    headers: { authorization: 'Bearer ${{WEBHOOK_TOKEN}}' },
    body: { email: '{{email}}' },
  }
  ```

  Here `{{email}}` resolves against the record the trigger fired for, while
  `${{USER_UPDATED_WEBHOOK_URL}}`/`${{WEBHOOK_TOKEN}}` resolve from `Deno.env` — both in the same
  action, without either system interfering with the other.
- Model interpolation (`{{field}}`) always runs first, then `${{ENV_VAR}}` interpolation — so an
  env-resolved value can itself sit next to record data in the same already-assembled string (e.g. a
  `url` whose path came from `{{field}}` and whose query-string token came from `${{ENV_VAR}}`).

## Conditions

```ts
const condition = {
  field: 'status',
  op: '=', // '<' | '>' | '=' | '<=' | '>=' | 'includes' | '!='
  value: 'active',
}
```

An action's `conditions` is an array evaluated with an implicit AND — every condition must pass for
the action to dispatch. Conditions can also nest logical groups:

```ts
const orGroup = {
  or: [{ field: 'role', op: '=', value: 'admin' }, { field: 'role', op: '=', value: 'owner' }],
}
const andGroup = { and: [/* ... */] }
const notGroup = { not: [/* ... */] }
```

`value` supports two special forms beyond a literal:

- **`'!$undefined'`** — compares the field against `undefined` (e.g. "this field was never set").
- **A string starting with `$`** — compares against another field on the same data instead of a
  literal (e.g. `{ field: 'startDate', op: '<', value: '$endDate' }`).

## Document- and query-level coverage

Triggers hook into **both** the document level (`.save()`, for a hydrated instance) and the query
level (`Model.updateOne`/`findOneAndUpdate`, `Model.deleteOne`/`findOneAndDelete`) — the same
limitation [Data Protection](./DATA-PROTECTION.md#protecting-a-value-before-writing-it) documents
for its `pre('save')` hook doesn't apply here, since these hooks are registered directly against the
query-level methods too. `pre` actions fire in the corresponding pre-hook, `post` actions in the
corresponding post-hook, symmetrically across both paths.

**Not covered**: `insertMany` (bypasses document middleware and isn't a single-document query
either) and bulk operations (`bulkWrite`, `updateMany`, `deleteMany`).

## Dispatched payload

A dispatched job's `args` carries the action's own fields — already interpolated, both against the
record (`{{field}}`) and against `Deno.env` (`${{ENV_VAR}}`) — (`to`/`subject`/`body`/`from`/`date`
for `mail`, `url`/`method`/`headers`/`body` for `request`) — plus `priority`, `delay`, and a nested
`data` object with the full record:

```ts
const args = {
  // ...the action's own fields, interpolated
  priority,
  delay,
  data: {
    _data: {/* the document's current fields (the deleted record, for a `deleted` trigger) */},
    _oldData: {/* the pre-change document, only present for updated/deleted */},
    ...actionData, // whatever the action's own `data` option (from TriggerActionCommons) set
  },
}
```

`args.data` is always there, for every action type, including `custom` — so a custom job you wrote
yourself gets full, uninterpolated access to the record regardless of what (if anything) `mail`/
`request` used via `{{field}}` placeholders.

**`_timeout`** (also from `TriggerActionCommons`, alongside `priority`/`delay`/`data`/`conditions`)
is only consumed on the local dispatch path (`runTask`, when `AMQP_URI` isn't configured), as that
task's own timeout in milliseconds (default `20_000`). A queue-backed dispatch (`runJob`, when
`AMQP_URI` is set) has no timeout counterpart to forward it to, so it's silently dropped in that
case:

```ts
custom: { name: 'slow-report-job', _timeout: 60_000 }
```

**Data protection is reversed before dispatch.** If the model has
[Data Protection](./DATA-PROTECTION.md) configured, every document a trigger sees — the current
record, `_oldData`, or the deleted record — has its protected paths already decrypted/unmasked
(hashed paths are dropped instead, same as a client-facing read), exactly like a normal `toJSON()`
response would show. A trigger's `{{field}}` interpolation and `conditions` never see raw ciphertext
or a hash. This is consistent across every path: document-level `.save()` (`created`/`updated`) and
query-level `updateOne`/`findOneAndUpdate`/`deleteOne`/`findOneAndDelete`.

## Persisted triggers (online adaptation)

Triggers can also be added, edited, or toggled at runtime, without a redeploy, via the internal
triggers collection (`ZanixMongoConnector`'s `triggersModel` option — defaults to
`"zanix-triggers"`, or `false` to disable it entirely). There are two ways an entry ends up there:

**1. Auto-seeded from a model's own `extensions.triggers`.** Every model registered via
`registerModel` with a static `extensions.triggers` gets a matching entry **auto-created** the first
time its connector boots with a triggers model enabled — `active: true`, `isDefault: true`,
`triggers` mirroring the code exactly. From that point on, **this entry is the sole source of truth
for that model's triggers**: its static `extensions.triggers` never fires directly again, so there's
no risk of the same action dispatching twice. This is what makes a code-defined trigger editable and
disableable from the database:

```ts
// After the model below has connected once, this collection already has a matching entry —
// written by the library itself, not by you — that you can now edit or disable directly.
await TriggersModel.updateOne(
  { model: 'users' },
  { $set: { active: false } }, // turns the code-defined trigger off entirely
  // or: { $set: { triggers: { post: { created: [{ custom: { name: 'a-different-job' } }] } } } }
)
```

Deleting this entry **doesn't stick** — since seeding only happens when no entry exists yet for a
model, the next boot re-seeds it fresh from whatever the code currently declares. **`active: false`
is the only way to durably turn a code-defined trigger off**; deleting the row just resets it back
to its code default on the next restart.

An auto-seeded entry also **stays in sync with its model's code** on every boot:

- **The model's `extensions.triggers` is removed from code entirely** → its entry is **deleted**.
  There's nothing left in code for it to represent, so it's cleaned up rather than left dispatching
  forever with stale, orphaned content.
- **The code's trigger content changed, and nobody edited `triggers` directly since it was last
  seeded or synced** → the entry is **updated** to match the new code content, keeping the two in
  sync automatically across deploys.
- **The entry WAS edited directly** (its `triggers` no longer matches what was last synced from
  code) → it's **left alone**, even if the code changes too. A manual edit always wins over a later
  code change — a deploy can never silently overwrite an operator's customization.

This is why you don't need to track any of this yourself: an entry that's still exactly what code
last gave it stays interchangeable with code (edit code, redeploy, it updates); the moment you edit
it directly in the database, it becomes independent of code from then on, until you delete it (which
resets it back to whatever code currently says).

**2. Created from scratch**, independent of any static configuration (e.g. via an admin endpoint) —
for a model that may or may not also have its own `extensions.triggers`:

```ts
// Written by any consumer, e.g. an admin endpoint — this library never writes an entry like this
// one itself; only auto-seeded (`isDefault: true`) entries are written by the library.
await TriggersModel.create({
  model: 'users',
  active: true,
  triggers: {
    post: { created: [{ custom: { name: 'welcome-email-job' } }] },
  },
})
```

This kind of entry **combines with** (never replaces) the target model's static
`extensions.triggers` — both sets' actions run, exactly like an auto-seeded entry that's since had
its `active` field toggled would NOT (that one fully replaces, per point 1 above). The distinction
is the `isDefault` field: `true` (auto-seeded, replaces static) vs. `false`/absent (created from
scratch, adds on top of static).

This package exports `TriggersAdminRepository`/`TriggersAdminService` as ready-made CRUD data
access/business logic over exactly this collection — the same "created from scratch" case above,
just implemented once instead of every consumer hand-rolling `TriggersModel.create`/`updateOne`
calls. `create`/`update` accept `CreateTriggerInput`/`UpdateTriggerInput` — both derived from
`TriggersModelAttrs` (`{ model, active, triggers }`, and a partial of `{ active, triggers }`,
respectively) rather than hand-declared, so they can never drift from the schema they target.
`@zanix/admin`'s `createTriggersAdminController` composes `TriggersAdminService` into a business
service's own authenticated `/admin/triggers` HTTP API; this package only owns the data access,
never the HTTP surface itself.

This package also exports `createTriggersDiscoveryProvider()`, building the `DiscoveryProvider` for
`/.well-known/zanix/triggers` (backed by `TriggersAdminRepository.list()`) that `@zanix/admin`'s
`defineAdminMetadata` registers via `@zanix/server`'s `ProgramModule.defineDiscovery` — see
`@zanix/server`'s `docs/HANDLERS.md` for what a Discovery provider is. As with the
repository/service above, this package only authors the provider; `@zanix/admin` is what wires it
into an HTTP surface.

Every `active` entry is read once at connector startup, and kept up to date after that without a
restart — see [Keeping the registry fresh](#keeping-the-registry-fresh-without-a-restart) below. A
previously-active entry that's now `false` (or was deleted, for a non-default one) stops taking
effect once that refresh happens, not just for newly-added ones.

**`mail` and `request` work fully from the database alone** — no code changes needed, since both
dispatch to a well-known, always-registered job name. **`custom` does not**: it only references a
job name, so unless that name was already registered via `@zanix/asyncmq`'s `registerJob` somewhere
in your code, adding a `custom` entry purely through this collection has nothing to run.

> ⚠️ **Auto-seeding only sees models registered before `connect()`** — the standard `registerModel`
> DSL usage, executed at module-load time. A model bound dynamically via
> `getModel(name, schema,
> { extensions })` **after** the connector has already connected won't get
> auto-seeded on that boot (its static trigger still fires directly and normally, exactly as if no
> triggers model were configured at all — it's just not yet editable from the database until a later
> boot registers it early enough to be seen).
>
> ⚠️ **`triggersModel: false` always means "only code triggers" for that connector** — on startup, a
> connector always resets its own in-memory persisted-triggers state first, regardless of its own
> `triggersModel` setting, so it never inherits whatever was previously loaded into that same
> bucket. This state is scoped per connector (see
> [Multiple Mongo connectors](./DATABASE.md#multiple-mongo-connectors)): two genuinely different
> connectors never share or wipe each other's persisted triggers. It only matters for the same
> connector re-instantiated (e.g. a reconnect, or a test suite creating several instances of the
> same class) — that case always starts from a clean slate, never carrying over what the previous
> instance had loaded.

### Keeping the registry fresh without a restart

A trigger added, edited, or toggled in this collection doesn't require restarting the app — three
complementary mechanisms keep the in-memory registry current, layered so each covers what the others
can't:

| Mechanism        | Enabled by                                                              | Speed                      | Covers writes from                                           |
| ---------------- | ----------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| On-write refresh | Always on, no configuration                                             | Instant                    | This connector's own model only                              |
| Polling          | `triggersPollInterval` (ms) or `TRIGGERS_POLL_INTERVAL` env var         | Up to one interval's delay | Any process/replica, or a direct DB edit                     |
| Change Stream    | `triggersChangeStream: true` or `TRIGGERS_CHANGE_STREAM='true'` env var | Near-instant               | Any process/replica — requires a replica set/sharded cluster |

- **On-write refresh** — the persisted triggers model's own schema gets `post('save')`/
  `post(['updateOne', 'findOneAndUpdate'])`/`post(['deleteOne', 'findOneAndDelete'])` hooks that
  re-read the collection the moment a write commits _through this connector's own model_ (e.g. an
  admin endpoint in the same app calling `TriggersModel.updateOne(...)`). Always on, no
  configuration needed — but it can't see a write made by a different process, a separate replica's
  own model instance, or a raw edit made directly in the database (Mongoose middleware is
  client-side; it only fires for operations issued through that same JS model object).
- **Polling** (`triggersPollInterval`, milliseconds, `false`/omitted by default — or the
  `TRIGGERS_POLL_INTERVAL` env var when the option is left unset, same disabling rules) — a safety
  net that re-reads the collection on a timer, catching everything on-write refresh can't: a write
  from a separate service, another horizontally-scaled replica of this same app, or a direct
  database edit (e.g. via `mongosh`/Compass). Works regardless of deployment topology, at the cost
  of up to one interval's delay:

  ```ts
  const connector = new ZanixMongoConnector({ triggersPollInterval: 5000 }) // re-read every 5s
  ```

- **Change Stream** (`triggersChangeStream: true`, `false` by default — or the
  `TRIGGERS_CHANGE_STREAM='true'` env var when the option is left unset) — watches the collection
  via MongoDB's Change Streams API, refreshing the moment any write commits, from any process or
  replica, without waiting for `triggersPollInterval`. **Requires a replica set or sharded cluster**
  — against a standalone instance, starting the watch fails; that failure is logged and the
  connector keeps running normally on the other two mechanisms instead of crashing:

  ```ts
  const connector = new ZanixMongoConnector({ triggersChangeStream: true })
  ```

  An explicit option always wins over its env var, the same rule every option/env-var pair in this
  package follows — see [Configuration](./CONFIGURATION.md#connection-variables).

For a horizontally-scaled deployment (several replicas of the same app), on-write refresh only
updates the replica that made the write — polling or Change Streams are what propagate the change to
every other replica. If you're on a replica set, Change Streams alone (no polling) gives
near-instant sync everywhere; if you aren't, polling is the only cross-replica option.

## See also

- [Database](./DATABASE.md) — `registerModel`'s `extensions`, where triggers attach.
- [Data Protection](./DATA-PROTECTION.md) — the other schema-level `pre('save')` hook, and its
  documented document- vs query-level limitation.
- [Configuration](./CONFIGURATION.md) — environment variables read elsewhere in the package.
