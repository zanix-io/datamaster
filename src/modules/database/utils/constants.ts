/**
 * Env var that, set to the literal string `'false'`, disables running any registered seeder —
 * checked both at model registration time (`defs/models.ts`) and at actual seeder-run time
 * (`mongo/connector/seeders.ts`), the same convention `TRIGGERS_MODEL_NAME`/`DATABASE_TEMPLATES`
 * use elsewhere in the Zanix ecosystem for an on-by-default feature.
 */
export const DATABASE_SEEDERS_ENV = 'DATABASE_SEEDERS'

/**
 * Env var that, set to the literal string `'true'`, enables `autoProtectOnUpdate` for every model
 * that doesn't set the `extensions.autoProtectOnUpdate` option explicitly — an explicit per-model
 * value always wins over this default. `false`/unset by default (opt-in), so no application already
 * in production changes behavior without asking for it.
 */
export const AUTO_PROTECT_ON_UPDATE_ENV = 'AUTO_PROTECT_ON_DB_UPDATE'
