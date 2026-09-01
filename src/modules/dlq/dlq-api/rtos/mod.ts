/**
 * The lightweight RTO/DTO layer of this package's own local DLQ API — pure validation classes,
 * with no data-access dependency at all. Exposed as its own subpath specifically for a consumer
 * that only needs these wire shapes without also resolving {@link DlqAdminService}
 * (`@zanix/datamaster/dlq-api`'s own root barrel imports it at its own top level, via
 * `createDlqAdminController`, to build its `local-dlq.handler.ts`'s own controller).
 *
 * The reason differs from `@zanix/datamaster/triggers-api/rtos`'s own: `DlqAdminService`/
 * `DlqProvider` only ever reference `database/mod.ts` as a type (`AdaptedModel`/
 * `ZanixMongoConnector`), erased at compile time, so no `mongoose` value import reaches this
 * chain. What this subpath actually avoids is `@zanix/server` itself — `DlqAdminService` imports
 * `Interactor`/`ZanixInteractor`, `DlqProvider` imports `ZanixProvider`, and
 * `local-dlq.handler.ts`'s own `createDlqAdminController` imports `Controller`/`ZanixController`,
 * all from `@zanix/server`'s single-entry `mod.ts` — the same file that also exports its own
 * webserver bootstrap machinery (`bootstrapServers`, `WebServerManager`) alongside every
 * connector/provider it ships. A consumer that only needs one of these RTOs to validate a request
 * before forwarding it elsewhere — e.g. a `@zanix/space` app built against a REMOTE DLQ API — has
 * no reason to pull any of that in just to reach a validation class.
 *
 * @module
 */
export { DlqEntryIdParamsRTO } from './local-dlq.rto.ts'
export {
  DiscardDlqEntryRTO,
  ListDlqEntriesRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from './dlq.rto.ts'
