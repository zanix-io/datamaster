/**
 * The local-api layer for this package's own persisted triggers collection — a real
 * `@zanix/server` `ZanixController` REST surface over {@link TriggersAdminService}
 * (`../triggers.service.ts`), never the other way around. This is the ONLY subpath under
 * `modules/triggers/` allowed to import `@zanix/server`'s `Controller`/`ZanixController` family;
 * `../triggers.service.ts`/`../triggers.repository.ts` stay agnostic of HTTP — see
 * `src/@tests/unit/triggers/dependency-boundary.test.ts` for the enforced proof.
 *
 * Exposed publicly as `@zanix/datamaster/triggers-api`, the same subpath-export shape
 * `@zanix/space/assets-api` already establishes for its own local API.
 *
 * @module
 */

export {
  createTriggersAdminController,
  type TriggersAdminControllerOptions,
} from './local-triggers.handler.ts'
export { TriggerModelParamsRTO } from './rtos/local-triggers.rto.ts'
export { CreateTriggerRTO, UpdateTriggerRTO } from './rtos/triggers.rto.ts'

/**
 * The CRUD data-access layer {@link createTriggersAdminController} itself sits on top of —
 * re-exported here so a consumer that composes its own extension on this local API (`@zanix/admin`'s
 * cross-service triggers aggregation, which reads {@link TriggersAdminRepository}/
 * {@link TriggersAdminService} directly) can reach them without also resolving the bare
 * `@zanix/datamaster` root's unrelated cache/storage/observability surface. Adds nothing to this
 * subpath's own reachable graph: this controller already imports {@link TriggersAdminService} to
 * build its own handlers.
 */
export { TriggersAdminRepository } from '../triggers.repository.ts'
export { TriggersAdminService } from '../triggers.service.ts'
/** Builds the `DiscoveryProvider` for `/.well-known/zanix/triggers`, backed by
 * {@link TriggersAdminRepository}. `@zanix/admin` composes this into an HTTP surface via
 * `ProgramModule.defineDiscovery`; it does not author the provider itself. */
export { createTriggersDiscoveryProvider } from '../triggers-discovery.provider.ts'
