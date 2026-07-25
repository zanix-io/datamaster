# Database

`ZanixMongoConnector`, the `registerModel` DSL, seeders, multi-database support, and the SQLite
key-value store.

## `ZanixMongoConnector`

```ts
import { ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]'

// Auto-initializes on construction (autoInitialize defaults to true) — no manual
// initialize() call needed. `initialize`/`close` are protected: the framework or
// this connector itself manages the connection lifecycle.
const connector = new ZanixMongoConnector({
  uri: process.env.MONGO_URI, // falls back to MONGO_URI env var, then 'mongodb://localhost'
  seedModel: 'my-seed-register-model', // default: 'zanix-seeders'; false disables seed tracking
  triggersModel: 'my-triggers', // default: 'zanix-triggers'; false disables persisted triggers
  config: { dbName: 'my_database' },
})

await connector.isReady

const UsersModel = connector.getModel<Attrs>('users')
```

`isReady` (inherited, a `Promise<boolean>`) is the property to await — there's no `connectorReady`.
`seedModel` names (or disables, with `false`) the internal collection used to track which seeders
have already run, so restarts don't re-run them — see
[Seeders](#seeders-registermodels-extensionsseeders). `triggersModel` names (or disables) the
internal collection used to add/toggle triggers at runtime — see
[Triggers: persisted triggers](./TRIGGERS.md#persisted-triggers-online-adaptation).

### `getModel`

Two overloads, depending on whether you already registered the model via `registerModel`:

```ts
// 1. Create a model directly from a schema you provide
const Model = connector.getModel('users', schema, { useALS: true })

// 2. Look up a model that was already bound via registerModel (throws if not found)
const Model = connector.getModel<Attrs>('users')
```

`GetModelOptions.useALS: boolean` re-enters the current request's `AsyncLocalStorage` session
context before resolving the model, so accessors that read the session (like
[`dataAccessGetter`](./DATA-PROTECTION.md#access-strategies-dataaccessgetter)) see it — enable this
if `useALS`/`enableALS` is already active on the handler that's calling `getModel`. The schema
overload's `SchemaModelInitOptions` also accepts `extensions` and `relatedModels` (models to bind
and populate together with the main one).

## `registerModel` DSL

```ts
import { registerModel } from 'jsr:@zanix/datamaster@[version]'

registerModel<Attrs>({
  name: 'users',
  definition: {
    name: String,
    email: { type: String, get: dataPoliciesGetter({/* ... */}) },
  },
  extensions: {
    seeders: [
      async function seedAdmin(Model) {
        const exists = await Model.findById('...')
        if (exists) return
        return new Model({ id: '...', name: 'Admin' }).save()
      },
    ],
  },
  callback: (schema) => {
    schema.index({ name: 1 })
    return schema
  },
})
```

`extensions.seeders` accepts an array mixing two forms: a plain
`(Model, connector) => void |
Promise<void>` function, or
`{ handler, options: { version, verbose, runningMode } }` for more control. Seeders run
**sequentially**. `callback` receives the built `schema` and must return it (possibly modified).

## Seeders (`registerModel`'s `extensions.seeders`)

```ts
import { seedByIdIfMissing, seedManyByIdIfMissing } from 'jsr:@zanix/datamaster@[version]'

registerModel({
  name: 'users',
  definition: { name: String },
  extensions: {
    seeders: [
      seedByIdIfMissing({ id: '...', name: 'Admin' }),
      seedManyByIdIfMissing([{ id: '...', name: 'A' }, { id: '...', name: 'B' }]),
    ],
  },
})
```

Both **upsert by `id`** (they don't fail if the document already exists — existing documents are
left unchanged) and default `useDataPolicies: true`, so protected/access-restricted fields go
through the same policies a normal save would — pass raw plaintext and let the schema's setter mask/
encrypt/hash it on the way in.

Pass `{ useDataPolicies: false }` when the seed data is **already** protected (e.g. a literal export
from a production database, with masked/encrypted values and their version prefix already baked in,
like `'v0:...'`) — otherwise the setter would protect an already-protected value a second time.

Skip execution globally with the `DATABASE_SEEDERS` environment variable — see
[Configuration](./CONFIGURATION.md).

To rotate protection keys across every document in a model, see
[Data Protection: key rotation](./DATA-PROTECTION.md#key-rotation).

`extensions` also accepts `triggers` — reactive `mail`/`request`/`custom` actions tied to a model's
create/update/delete lifecycle — see [Triggers](./TRIGGERS.md).

## Multi-database support

A model name (or a schema `ref`) can be prefixed with a database name using `'database:model'`:

```ts
registerModel({
  name: 'billing:invoices',
  definition: {
    customer: { type: Schema.Types.ObjectId, ref: 'accounts:users' },
  },
})

const Invoices = connector.getModel('billing:invoices')
```

The model is registered and looked up under the **full prefixed string** — always use
`'database:model'` consistently, both when calling `getModel` and in any `ref` that targets it.

> ⚠️ **Not recommended for microservices**: prefer one independent database per service to keep
> services decoupled, autonomous, and independently scalable. This convention exists for
> monoliths/shared-database scenarios where it's unavoidable.

## SQLite key-value store

```ts
import { ZanixKVStoreConnector } from 'jsr:@zanix/datamaster@[version]'

class MyKVStore extends ZanixKVStoreConnector<string> {}

const kv = new MyKVStore({ filename: 'my-store.sqlite' }) // default: 'znx.kv.tmp'

await kv.set('key', 'value', 60) // TTL in seconds; 'KEEPTTL' preserves the current expiration
const value = await kv.get('key')
await kv.withLock('key', async () => {/* exclusive per-key access, same lock manager as cache */})
```

TTL expiry is **lazy** — an expired entry is skipped on read, not proactively deleted. `withLock`
uses the same internal keyed lock manager the cache module uses (see [Cache](./CACHE.md#withlock)).
For direct SQLite table access without the KV/TTL semantics, use `LocalSQLite(table, filename?)`
directly.

## Pagination statics

Available on any bound model as `Model.paginate(...)`/`Model.paginateCursor(...)`:

```ts
const page = await UsersModel.paginate({ page: 1, limit: 10, filter: {}, sort: { _id: 1 } })
// { docs, page, limit, total, totalPages, hasNextPage, hasPrevPage }

const cursorPage = await UsersModel.paginateCursor({ limit: 10, cursor: page.docs.at(-1)?._id })
// { docs, limit, nextCursor, hasNextPage }
```

## See also

- [Triggers](./TRIGGERS.md) — `extensions.triggers`, reactive actions tied to the model lifecycle.
- [Data Protection](./DATA-PROTECTION.md) — `dataProtectionGetter`/`dataAccessGetter`, used inside a
  model's `definition`.
- [Transforms](./TRANSFORMS.md) — the schema/document transform utilities, and when to call them
  directly vs let `toJSON`/`toObject` handle them.
- [Configuration](./CONFIGURATION.md) — `MONGO_URI`, `DATABASE_SEEDERS`.
