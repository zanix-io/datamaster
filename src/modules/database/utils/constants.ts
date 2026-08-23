/**
 * Env var that, set to the literal string `'false'`, disables running any registered seeder —
 * checked both at model registration time (`defs/models.ts`) and at actual seeder-run time
 * (`mongo/connector/seeders.ts`), the same convention `TRIGGERS_MODEL_NAME`/`DATABASE_TEMPLATES`
 * use elsewhere in the Zanix ecosystem for an on-by-default feature.
 */
export const DATABASE_SEEDERS_ENV = 'DATABASE_SEEDERS'

/**
 * Env var that enables `autoProtectOnUpdate` for every model that doesn't set the
 * `extensions.autoProtectOnUpdate` option explicitly — an explicit per-model value always wins over
 * this default. On by default: only the literal string `'false'` disables it; unset, `'true'`, or
 * anything else all leave it enabled.
 *
 * This only ever covers document-level `.save()` on an already-hydrated, non-`isNew` document —
 * query-level operations (`updateOne`, `findOneAndUpdate`, `bulkWrite`) bypass Mongoose document
 * middleware entirely and are **never** protected by this, on or off. See
 * [Data Protection: automatic update-time protection](../../../../docs/data-protection.md#automatic-update-time-protection-autoprotectonupdate).
 */
export const AUTO_PROTECT_ON_UPDATE_ENV = 'AUTO_PROTECT_ON_DB_UPDATE'

/**
 * The DI key `@zanix/datamaster`'s own default Mongo connector resolves to — matches
 * `Connector('database')(ZanixMongoConnector)` (`mongo/connector/core.ts`) exactly, regardless of
 * which concrete subclass implements it (`getConnectorKey` resolves the core-slot alias, not the
 * class reference — see `@zanix/server`'s `utils/targets.ts`). `registerModel`/`ModelsContainer`/
 * `SeedersContainer` target this bucket whenever no explicit connector is given.
 */
export const DEFAULT_CONNECTOR_KEY = 'database'

/**
 * Env var that gates whether trigger dispatch (`mongo/processor/triggers/dispatch.ts`) publishes
 * to AsyncMQ (`runJob`, queue-backed) or falls back to running the job locally (`runTask`) — the
 * same `Deno.env.has(...)` availability-gate convention this ecosystem already uses elsewhere for
 * an optional external service (e.g. `REDIS_URI_ENV` for the Redis connector, `MONGO_URI_ENV` for
 * Mongo). Presence alone is checked, not the value.
 */
export const AMQP_URI_ENV = 'AMQP_URI'
