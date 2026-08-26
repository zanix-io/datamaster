import type { HandlerContext, MiddlewareGuard, VersionProtocolOption } from '@zanix/server'

import { Controller, Delete, Get, Guard, Post, ZanixController } from '@zanix/server'
import { DlqAdminService } from '../dlq.service.ts'
import {
  DiscardDlqEntryRTO,
  ListDlqEntriesRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from './rtos/dlq.rto.ts'
import { DlqEntryIdParamsRTO } from './rtos/local-dlq.rto.ts'

/** Options accepted by {@link createDlqAdminController}. */
export interface DlqAdminControllerOptions {
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
 * {@link DlqAdminControllerOptions.guards}'s own doc for why that's the honest default here. */
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
 * Builds the admin REST controller for this package's own persisted DLQ collection (this
 * package's own `zanix-dlq`). The route path itself (`admin/dlq`) is fixed, not configurable — the
 * same reasoning `createTriggersAdminController`'s own doc gives for `admin/triggers`.
 *
 * Exposes only `push`/`get`/`list`/`requeue`/`discard`/`remove` — the lease-based
 * `claim`/`release`/`complete`/`fail` primitives are deliberately absent from this REST surface;
 * see {@link DlqAdminService}'s own JSDoc for the full reasoning.
 *
 * A factory rather than a plain always-decorated class — `@Controller`'s `prefix` is decorator-time
 * (static) config, and `guards`/`versionProtocol` are real runtime values this factory closes over;
 * same reasoning `createTriggersAdminController` already establishes for its own local API. The
 * composer (typically `@zanix/admin`'s `defineAdminMetadata()`) calls this once at boot, wrapped in
 * whichever `defineApplication(...)` scope decides this route's Application.
 */
export function createDlqAdminController(
  options: DlqAdminControllerOptions = {},
): new (context: HandlerContext) => ZanixController<DlqAdminService> {
  const guard = combineGuards(options.guards)

  @Controller({
    prefix: 'admin/dlq',
    Interactor: DlqAdminService,
    versionProtocol: options.versionProtocol,
  })
  class _DlqAdminController extends ZanixController<DlqAdminService> {
    @Get('', { Search: ListDlqEntriesRTO })
    @Guard(guard)
    public list(ctx: HandlerContext<{ search: ListDlqEntriesRTO }>) {
      const { processType, status, origin, page, limit } = ctx.payload.search
      return this.interactor.list({ processType, status, origin, page, limit })
    }

    @Get(':id', { Params: DlqEntryIdParamsRTO })
    @Guard(guard)
    public get(ctx: HandlerContext<{ params: DlqEntryIdParamsRTO }>) {
      return this.interactor.get(ctx.payload.params.id)
    }

    @Post('', { Body: PushDlqEntryRTO })
    @Guard(guard)
    public push(ctx: HandlerContext<{ body: PushDlqEntryRTO }>) {
      const { processType, origin, processId, payload, error, maxAttempts, metadata } =
        ctx.payload.body
      return this.interactor.push({
        processType,
        origin,
        processId,
        payload,
        error,
        maxAttempts,
        metadata,
      })
    }

    @Post(':id/requeue', { Body: RequeueDlqEntryRTO, Params: DlqEntryIdParamsRTO })
    @Guard(guard)
    public requeue(
      ctx: HandlerContext<{ body: RequeueDlqEntryRTO; params: DlqEntryIdParamsRTO }>,
    ) {
      return this.interactor.requeue(ctx.payload.params.id, {
        resetAttempts: ctx.payload.body.resetAttempts,
      })
    }

    @Post(':id/discard', { Body: DiscardDlqEntryRTO, Params: DlqEntryIdParamsRTO })
    @Guard(guard)
    public discard(
      ctx: HandlerContext<{ body: DiscardDlqEntryRTO; params: DlqEntryIdParamsRTO }>,
    ) {
      return this.interactor.discard(ctx.payload.params.id, {
        reason: ctx.payload.body.reason,
      })
    }

    @Delete(':id', { Params: DlqEntryIdParamsRTO })
    @Guard(guard)
    public async remove(
      ctx: HandlerContext<{ params: DlqEntryIdParamsRTO }>,
    ) {
      await this.interactor.remove(ctx.payload.params.id)
      return { deleted: ctx.payload.params.id }
    }
  }

  return _DlqAdminController
}
