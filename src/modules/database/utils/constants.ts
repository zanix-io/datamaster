/**
 * Env var that, set to the literal string `'false'`, disables running any registered seeder —
 * checked both at model registration time (`defs/models.ts`) and at actual seeder-run time
 * (`mongo/connector/seeders.ts`), the same convention `TRIGGERS_MODEL_NAME`/`DATABASE_TEMPLATES`
 * use elsewhere in the Zanix ecosystem for an on-by-default feature.
 */
export const DATABASE_SEEDERS_ENV = 'DATABASE_SEEDERS'
