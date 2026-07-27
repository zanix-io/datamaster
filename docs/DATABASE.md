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
  triggersPollInterval: 5000, // default: false (disabled); re-reads persisted triggers every 5s
  triggersChangeStream: true, // default: false; requires a replica set/sharded cluster
  config: { dbName: 'my_database' },
})

await connector.isReady

const UsersModel = connector.getModel<Attrs>('users')
```

`isReady` (inherited, a `Promise<boolean>`) is the property to await — there's no `connectorReady`.
`seedModel` names (or disables, with `false`) the internal collection used to track which seeders
have already run, so restarts don't re-run them — see
[Seeders](#seeders-registermodels-extensionsseeders). `triggersModel` names (or disables) the
internal collection used to add/toggle triggers at runtime, and `triggersPollInterval`/
`triggersChangeStream` control how quickly a change made there takes effect without a restart — see
[Triggers: keeping the registry fresh](./TRIGGERS.md#keeping-the-registry-fresh-without-a-restart).

Every option above also has an environment variable counterpart, for when you'd rather configure it
per-deployment than in code — the explicit option always wins if both are set:

| Option                 | Env var                  |
| ---------------------- | ------------------------ |
| `uri`                  | `MONGO_URI`              |
| `seedModel`            | `SEED_MODEL_NAME`        |
| `triggersModel`        | `TRIGGERS_MODEL_NAME`    |
| `triggersPollInterval` | `TRIGGERS_POLL_INTERVAL` |
| `triggersChangeStream` | `TRIGGERS_CHANGE_STREAM` |

See [Configuration](./CONFIGURATION.md#connection-variables) for each one's exact defaults and
disabling convention (`'false'` for the two model-name variables).

### `getModel`

Three overloads, depending on whether you already registered the model via `registerModel`:

```ts
// 1. Create a model directly from a schema you provide
const Model = connector.getModel('users', schema, { useALS: true })

// 2. Create a model from a plain definition (registerModel's own {definition, options, extensions,
//    callback} shape) — the connector builds the Schema for you, so callers that only need this
//    one model never have to import `mongoose` themselves
const Model = connector.getModel<Attrs>('users', {
  definition: { name: { type: String, required: true } },
  extensions: { triggers: { post: { created: [{ custom: { name: 'my-job' } }] } } },
})

// 3. Look up a model that was already bound via registerModel (throws if not found)
const Model = connector.getModel<Attrs>('users')
```

`GetModelOptions.useALS: boolean` re-enters the current request's `AsyncLocalStorage` session
context before resolving the model, so accessors that read the session (like
[`dataAccessGetter`](./DATA-PROTECTION.md#access-strategies-dataaccessgetter)) see it — enable this
if `useALS`/`enableALS` is already active on the handler that's calling `getModel`. Both the schema
and the plain-definition overloads' `SchemaModelInitOptions` also accept `extensions` and
`relatedModels` (models to bind and populate together with the main one).

`SchemaModelInitOptions.onSeedersDone?: (Model, msg: string) => void` — the schema-instance
overload's own way to wait for `extensions.seeders` to finish, since `getModel` itself returns
synchronously before seeders settle:

```ts
await new Promise((resolve) => {
  connector.getModel('users', schema, {
    extensions: { seeders: [seedAdmin] },
    onSeedersDone: (Model, msg) => resolve(msg), // msg: 'seeders executed', or the failing error's message
  })
})
```

Not the same as `MongoModelDefinition`'s `callback` above (overload 2) — that one transforms the
schema itself, synchronously, before the model is even bound; `onSeedersDone` fires later, once
binding and seeding are both done.

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
