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
