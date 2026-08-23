import type { DiscoveryProvider } from '@zanix/server'
import type { DLQEntryAttrs, DLQStatus } from './dlq.typings.ts'

import { ProgramModule } from '@zanix/server'
import { DLQProvider } from './dlq.provider.ts'

/** Non-terminal, still-actionable statuses — the ones a `snapshot()` reader (a cross-service DLQ
 * dashboard) actually needs. `'completed'`/`'discarded'` are resolved history, retained forever
 * (`DLQProvider.remove()` is always manual — there's no TTL/auto-purge), so they're deliberately
 * left out; see this module's own top-level doc for the full reasoning. */
const UNRESOLVED_STATUSES: DLQStatus[] = ['pending', 'claimed', 'failed']

/** Per-status cap applied to each `DLQProvider.list()` call below. Three statuses at this limit
 * keep the merged result comfortably within the "dozens–low thousands" figure `@zanix/server`'s
 * own `DiscoveryProvider.snapshot()` JSDoc uses for what a snapshot-shaped resource should stay
 * under — never a full, unbounded materialization of the collection. */
const PER_STATUS_LIMIT = 500

/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/dlq` — see `@zanix/server`'s
 * `docs/handlers.md`'s "Discovery" section, and `createTriggersDiscoveryProvider` for the sibling
 * this mirrors. A future `DlqAggregator` in `@zanix/admin` (mirroring `TriggersAggregator`, not yet
 * built) would compose this the same way `defineAdminMetadata` composes the triggers one: this
 * package only authors the provider, since it's the actual owner of the persisted DLQ collection.
 *
 * `DLQProvider` is resolved fresh on every `snapshot()` call (never cached at construction time
 * here) — deferring DI resolution to request time, the same reasoning
 * `createTriggersDiscoveryProvider` documents for `TriggersAdminRepository`.
 *
 * **Why this doesn't just reuse `DLQProvider.list()`/`DLQAdminService.list()` unchanged, unlike
 * `createTriggersDiscoveryProvider`'s straight `TriggersAdminRepository.list()` reuse**:
 * `DiscoveryProvider<T>.snapshot()` is documented (`@zanix/server`'s own `typings/discovery.ts`) as
 * "fine for resources confirmed to stay small (dozens–low thousands of items)" — true for triggers
 * (few per service) but not for DLQ entries, which can be numerous and keep accumulating (no
 * TTL/auto-purge — see `DLQProvider.remove()`). Two changes follow from that, both deliberate:
 *
 * 1. **Only `'pending'`/`'claimed'`/`'failed'` entries are included** — `snapshot()`'s own contract
 *    frames this as "current state," and for DLQ that's the actionable backlog, not the
 *    indefinitely-retained `'completed'`/`'discarded'` history (which only grows, and is exactly the
 *    kind of unbounded shape `snapshot()` isn't designed for). This set is naturally self-limiting:
 *    an entry leaves it as soon as it's resolved, unlike the full collection.
 * 2. **Each status is fetched with its own bounded, capped `list()` call** — `DLQListOptions.status`
 *    (and its `filter` passthrough, which strips `$`-prefixed keys) only supports single-value
 *    equality, not a `$in`-style multi-status query, so "any of these three statuses" is expressed
 *    as three parallel, per-status-capped `list()` calls merged together, rather than one call with
 *    an unbounded/default (`limit: 10`) page size that would either silently truncate or need to
 *    reach past the provider's own public API into a raw Mongo query.
 *
 * A caller that wants the *full* paginated collection, including resolved entries — the real "browse
 * everything" case — uses `DLQAdminService.list()`/`admin/dlq` directly; this snapshot is
 * deliberately narrower than that.
 */
export function createDlqDiscoveryProvider(): DiscoveryProvider<DLQEntryAttrs> {
  return {
    snapshot: async () => {
      const provider = ProgramModule.providers.get(DLQProvider)
      const perStatus = await Promise.all(
        UNRESOLVED_STATUSES.map((status) =>
          provider.list({ status, limit: PER_STATUS_LIMIT, sort: { createdAt: -1 } })
        ),
      )
      return perStatus.flatMap((result) => result.docs)
    },
  }
}
