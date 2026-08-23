/**
 * The local-api layer for this package's own persisted DLQ collection — a real `@zanix/server`
 * `ZanixController` REST surface over {@link DLQAdminService} (`../dlq.service.ts`), never the
 * other way around. This is the ONLY subpath under `modules/dlq/` allowed to import
 * `@zanix/server`'s `Controller`/`ZanixController` family; `../dlq.service.ts`/`../dlq.provider.ts`
 * stay agnostic of HTTP — see `src/@tests/unit/dlq/dependency-boundary.test.ts` for the enforced
 * proof.
 *
 * Exposes only `push`/`get`/`list`/`requeue`/`discard`/`remove` — the lease-based
 * `claim`/`release`/`complete`/`fail` primitives are deliberately absent from this REST surface;
 * see {@link DLQAdminService}'s own JSDoc for why.
 *
 * Exposed publicly as `@zanix/datamaster/dlq-api`, the same subpath-export shape
 * `@zanix/datamaster/triggers-api` already establishes for its own local API.
 *
 * @module
 */

export { createDlqAdminController, type DLQAdminControllerOptions } from './local-dlq.handler.ts'
export { DLQEntryIdParamsRTO } from './rtos/local-dlq.rto.ts'
export {
  DiscardDLQEntryRTO,
  ListDLQEntriesRTO,
  PushDLQEntryRTO,
  RequeueDLQEntryRTO,
} from './rtos/dlq.rto.ts'
