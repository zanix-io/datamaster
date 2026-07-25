# Triggers

Reactive side effects (send an email, fire an HTTP request, run a custom job) tied to a model's
create/update/delete lifecycle, declared as data instead of imperative code.

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
            url: 'https://hooks.example.com/user-updated',
            method: 'POST',
            headers: { authorization: 'Bearer {{apiKey}}' },
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

| Action    | Fields                                    | How it's dispatched                                                              |
| --------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `mail`    | `to`, `subject`, `body`, `from?`, `date?` | Well-known job `DEFAULT_TRIGGER_JOBS.mail`                                       |
| `request` | `url`, `method`, `headers`, `body?`       | Well-known job `DEFAULT_TRIGGER_JOBS.request`                                    |
| `custom`  | `name`                                    | The job named `name` — one you (or `@zanix/asyncmq`) already registered yourself |

**Every string field** on `mail`/`request` (`to`, `subject`, `url`, `headers`' values, `body`'s own
values, ...) supports `{{field}}`/`{{nested.path}}` placeholders, resolved against the record the
trigger fired for. This is the **only** way a field sees per-record data — nothing is merged in
automatically beyond what a field's own placeholders resolve to (see
[Dispatched payload](#dispatched-payload)).

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

`mail.body` is `{ template: string; data?: Record<string, unknown> | string }` — `template` names
the notifier template, and `data` is its render data: an object of fields the template expects (a
`styles.css` key appends additional CSS to the template's own base stylesheet, concatenated, not
replaced), or a literal string for templates that accept plain content directly. This maps directly
onto `@zanix/notifications`'s `NotifyMessageWithTemplate`'s `{ template, data }` shape. String
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

> ⚠️ **`mail`/`request` need a consumer-side job registered under their well-known name to actually
> do anything.** Datamaster only **dispatches** — via `ProgramModule.providers.get('worker')` (from
> `@zanix/server`). Apps bootstrapped via `@zanix/core`'s `Zanix.start()`/`Zanix.startWorker()` get
> both handlers registered automatically — `@zanix/core` is the layer that depends on datamaster,
> asyncmq, _and_ notifications simultaneously, so it (not asyncmq itself) owns this wiring. A
> `custom` action works end-to-end today as long as you've registered that job name yourself via
> `@zanix/asyncmq`'s `registerJob` — the same job a `this.worker.runJob(name, ...)` call from an
> interactor would target.
>
> Dispatch itself picks `runJob` (queue-backed) when `AMQP_URI` is configured, or falls back to
> `runTask` (local, in-process) when it isn't — there's no queue to publish to in that case, the
> same way [Cache](./CACHE.md) only registers the Redis connector when `REDIS_URI` is set.

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

A dispatched job's `args` carries the action's own fields — already interpolated (`to`/`subject`/
`body`/`from`/`date` for `mail`, `url`/`method`/`headers`/`body` for `request`) — plus `priority`,
`delay`, and a nested `data` object with the full record:

```ts
const args = {
  // ...the action's own fields, interpolated
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

Every `active` entry is read once at connector startup — a previously-active entry that's now
`false` (or was deleted, for a non-default one) stops taking effect on the next boot, not just
newly-added ones.

**`mail` and `request` work fully from the database alone** — no code changes needed, since both
dispatch to a well-known, always-registered job name. **`custom` does not**: it only references a
job name, so unless that name was already registered via `@zanix/asyncmq`'s `registerJob` somewhere
in your code, adding a `custom` entry purely through this collection has nothing to run.

> ⚠️ **Not live-reloading**: entries are read (and, for default ones, seeded) once, right after the
> database connection is established. A trigger added, edited, or toggled in this collection while
> the app is already running and connected only takes effect on the **next restart**, not
> immediately.
>
> ⚠️ **Auto-seeding only sees models registered before `connect()`** — the standard `registerModel`
> DSL usage, executed at module-load time. A model bound dynamically via
> `getModel(name, schema,
> { extensions })` **after** the connector has already connected won't get
> auto-seeded on that boot (its static trigger still fires directly and normally, exactly as if no
> triggers model were configured at all — it's just not yet editable from the database until a later
> boot registers it early enough to be seen).
>
> ⚠️ **`triggersModel: false` always means "only code triggers,"** even across multiple connectors
> in the same process (e.g. a reconnect, or a test suite creating several) — every connector resets
> the in-memory persisted-triggers state on startup, regardless of its own `triggersModel` setting,
> so it never inherits a previous connector's loaded entries.

## See also

- [Database](./DATABASE.md) — `registerModel`'s `extensions`, where triggers attach.
- [Data Protection](./DATA-PROTECTION.md) — the other schema-level `pre('save')` hook, and its
  documented document- vs query-level limitation.
- [Configuration](./CONFIGURATION.md) — environment variables read elsewhere in the package.
