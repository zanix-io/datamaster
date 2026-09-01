/**
 * The lightweight RTO/DTO layer of this package's own local triggers API — pure validation
 * classes, with no data-access dependency at all. Exposed as its own subpath specifically for a
 * consumer that only needs these wire shapes without also resolving {@link TriggersAdminRepository}/
 * {@link TriggersAdminService} (`@zanix/datamaster/triggers-api`'s own root barrel re-exports both
 * from the SAME file) — those pull in `database/mod.ts`, which unconditionally `export`s
 * `Schema`/`Document`/`Model` from `mongoose`. A consumer with no database of its own — e.g.
 * `@zanix/console`, a pure remote-API frontend that only needs {@link CreateTriggerRTO} to validate
 * a form body before forwarding it to a REMOTE triggers API — has no reason to pull
 * `mongoose`/`mongodb` into its own `zanix space dev` SSR bundle just to reach a validation class.
 *
 * @module
 */
export { CreateTriggerRTO, UpdateTriggerRTO } from './triggers.rto.ts'
export { TriggerModelParamsRTO } from './local-triggers.rto.ts'
