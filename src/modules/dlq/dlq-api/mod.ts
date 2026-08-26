/**
 * The local-api layer for this package's own persisted DLQ collection — a real `@zanix/server`
 * `ZanixController` REST surface over {@link DlqAdminService} (`../dlq.service.ts`), never the
 * other way around. This is the ONLY subpath under `modules/dlq/` allowed to import
 * `@zanix/server`'s `Controller`/`ZanixController` family; `../dlq.service.ts`/`../dlq.provider.ts`
 * stay agnostic of HTTP — see `src/@tests/unit/dlq/dependency-boundary.test.ts` for the enforced
 * proof.
 *
 * Exposes only `push`/`get`/`list`/`requeue`/`discard`/`remove` — the lease-based
 * `claim`/`release`/`complete`/`fail` primitives are deliberately absent from this REST surface;
 * see {@link DlqAdminService}'s own JSDoc for why.
 *
 * Exposed publicly as `@zanix/datamaster/dlq-api`, the same subpath-export shape
 * `@zanix/datamaster/triggers-api` already establishes for its own local API.
 *
 * @module
 */

export { createDlqAdminController, type DlqAdminControllerOptions } from './local-dlq.handler.ts'
export { DlqEntryIdParamsRTO } from './rtos/local-dlq.rto.ts'
export {
  DiscardDlqEntryRTO,
  ListDlqEntriesRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from './rtos/dlq.rto.ts'

// Deprecated aliases — this package used to case the `DLQ` acronym all-caps; it now consistently
// cases it `Dlq` (see `@zanix/datamaster`'s CHANGELOG `[Unreleased]` entry). These re-export the
// exact same bindings under their old names for one deprecation window — the `Dlq...` names above
// are the recommended form; don't reach for these in new code.
/** @deprecated Use {@link DlqAdminControllerOptions} instead — this alias will be removed in a
 * future major release. */
export type { DlqAdminControllerOptions as DLQAdminControllerOptions } from './local-dlq.handler.ts'
/** @deprecated Use {@link DlqEntryIdParamsRTO} instead — this alias will be removed in a future
 * major release. */
export { DlqEntryIdParamsRTO as DLQEntryIdParamsRTO } from './rtos/local-dlq.rto.ts'
/** @deprecated Use {@link DiscardDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { DiscardDlqEntryRTO as DiscardDLQEntryRTO } from './rtos/dlq.rto.ts'
/** @deprecated Use {@link ListDlqEntriesRTO} instead — this alias will be removed in a future
 * major release. */
export { ListDlqEntriesRTO as ListDLQEntriesRTO } from './rtos/dlq.rto.ts'
/** @deprecated Use {@link PushDlqEntryRTO} instead — this alias will be removed in a future major
 * release. */
export { PushDlqEntryRTO as PushDLQEntryRTO } from './rtos/dlq.rto.ts'
/** @deprecated Use {@link RequeueDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { RequeueDlqEntryRTO as RequeueDLQEntryRTO } from './rtos/dlq.rto.ts'
