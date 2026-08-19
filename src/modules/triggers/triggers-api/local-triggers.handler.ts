import type { HandlerContext, MiddlewareGuard, VersionProtocolOption } from '@zanix/server'

import { Controller, Delete, Get, Guard, Post, Put, ZanixController } from '@zanix/server'
import { TriggersAdminService } from '../triggers.service.ts'
import { CreateTriggerRTO, UpdateTriggerRTO } from './rtos/triggers.rto.ts'
import { TriggerModelParamsRTO } from './rtos/local-triggers.rto.ts'

/** Options accepted by {@link createTriggersAdminController}. */
export interface TriggersAdminControllerOptions {
  /**
   * Guards applied to every route on this controller, run in order, short-circuiting on the first
   * denial. Omitted/empty means no guard at all — this package never assumes an auth mechanism (it
   * doesn't depend on `@zanix/auth`) and never invents its own `permissions`/`roles` concept; the
   * composer (typically `@zanix/admin`) is the one that knows what "admin" means and builds the
   * real guard, e.g. from `@zanix/auth`'s `jwtValidationGuard`. See the "Local API vs Aggregator
   * API" rule in the `zanix-libraries-architecture` skill for why the auth mechanism is always
   * supplied by the composer, never assumed here.
   */
  guards?: MiddlewareGuard[]
  /**
   * Protocol-version negotiation for this controller, passed straight to `@Controller`. Defaults to
   * `@zanix/server`'s own generic default when omitted — a composer preserving an existing wire
   * contract (e.g. `@zanix/admin`'s own protocol config) should pass it explicitly here instead of
   * this package hardcoding a value with "admin" in its name.
   */
  versionProtocol?: VersionProtocolOption
}

/** Combines a guard list into ONE guard: runs each in order, short-circuiting on the first
 * denial. An empty/omitted list resolves to an always-allow guard — see
 * {@link TriggersAdminControllerOptions.guards}'s own doc for why that's the honest default here. */
function combineGuards(guards: MiddlewareGuard[] | undefined): MiddlewareGuard {
  const list = guards ?? []
  return async (context, ...args) => {
    for (const guard of list) {
      // deno-lint-ignore no-await-in-loop
      const result = await guard(context, ...args)
      if (result.response) return result
    }
    return {}
  }
}

/**
 * Builds the admin CRUD controller for a business service's own persisted triggers collection
 * (this package's own `zanix-triggers`). The route path itself (`admin/triggers`) is fixed, not
 * configurable — it's the wire-protocol contract `@zanix/admin`'s `TriggersAdminClient` (and any
 * other caller) hardcodes.
 *
 * A factory rather than a plain always-decorated class — `@Controller`'s `prefix` is decorator-time
 * (static) config, and `guards`/`versionProtocol` are real runtime values this factory closes over;
 * same reasoning `@zanix/space`'s `createAssetsController` already establishes for its own local
 * API. The composer (typically `@zanix/admin`'s `defineAdminMetadata()`) calls this once at boot,
 * wrapped in whichever `defineApplication(...)` scope decides this route's Application.
 *
 * Unlike a proxying aggregator over N services (`@zanix/admin`'s own `/triggers`,
 * `createTriggersController`), this controller's own CRUD logic ({@link TriggersAdminService}, owned
 * and authored by this package) owns real persisted data directly — a business service's own local
 * triggers, not a fan-out to other services.
 */
export function createTriggersAdminController(
  options: TriggersAdminControllerOptions = {},
): new (context: HandlerContext) => ZanixController<TriggersAdminService> {
  const guard = combineGuards(options.guards)

  @Controller({
    prefix: 'admin/triggers',
    Interactor: TriggersAdminService,
    versionProtocol: options.versionProtocol,
  })
  class _TriggersAdminController extends ZanixController<TriggersAdminService> {
    @Get()
    @Guard(guard)
    public list() {
      return this.interactor.list()
    }

    @Get(':model', { Params: TriggerModelParamsRTO })
    @Guard(guard)
    public get(ctx: HandlerContext<{ params: TriggerModelParamsRTO }>) {
      return this.interactor.get(ctx.payload.params.model)
    }

    @Post('', { Body: CreateTriggerRTO })
    @Guard(guard)
    public create(ctx: HandlerContext<{ body: CreateTriggerRTO }>) {
      const { model, active, triggers } = ctx.payload.body
      return this.interactor.create({ model, active, triggers })
    }

    @Put(':model', { Body: UpdateTriggerRTO, Params: TriggerModelParamsRTO })
    @Guard(guard)
    public update(
      ctx: HandlerContext<
        { body: UpdateTriggerRTO; params: TriggerModelParamsRTO }
      >,
    ) {
      const { active, triggers } = ctx.payload.body
      return this.interactor.update(ctx.payload.params.model, {
        active,
        triggers,
      })
    }

    @Delete(':model', { Params: TriggerModelParamsRTO })
    @Guard(guard)
    public async remove(
      ctx: HandlerContext<{ params: TriggerModelParamsRTO }>,
    ) {
      await this.interactor.remove(ctx.payload.params.model)
      return { deleted: ctx.payload.params.model }
    }
  }

  return _TriggersAdminController
}
