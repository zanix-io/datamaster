/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * Dead Letter Queue — data access and lifecycle logic for a Mongo-backed registry of items that
 * failed in some business process (payments, webhooks, jobs, ...), for auditing/debugging/manual
 * or programmatic retry. Independent of `@zanix/asyncmq`'s own RabbitMQ-native dead-letter
 * mechanism (`ZanixAsyncMQProvider.requeueDeadLetters`) — see `docs/dlq.md` for the distinction.
 *
 * A narrow entry point for a consumer that only needs the `DlqProvider` class and its supporting
 * types/model registration — reaches Mongo (this collection is Mongo-backed) but never the cache
 * module's own Redis/Memcached stack, unlike importing from this package's root `.`. Distinct from
 * `@zanix/datamaster/dlq-api`, which is this same business logic fronted by a local
 * `/admin/dlq` REST surface, a different audience.
 *
 * @module zanixDlq
 */

export {
  /**
   * Data access and lifecycle logic for `@zanix/datamaster`'s own persisted DLQ collection
   * (`zanix-dlq` by default, or `DLQ_MODEL_NAME`). Registered under the `'dlq'` core-provider slot
   * — resolve it via `this.providers.get(DlqProvider)` or `this.providers.get('dlq')`. Requires
   * `registerDlqModel()` to have run once during the app's own bootstrap.
   */
  DlqProvider,
  /** Empty marker contract for the `'dlq'` core-provider slot (`dlq/core.ts`) — see this class's
   * own JSDoc for the full rationale. No behavior of its own — never instantiated directly. */
  ZanixCoreDlqProvider,
} from './dlq.provider.ts'
export type {
  /** `DlqProvider.list()`'s own paginated result shape. */
  DlqPaginatedResult,
} from './dlq.provider.ts'

/**
 * Business logic behind this package's own local `/admin/dlq` — see
 * `@zanix/datamaster/dlq-api`'s own `createDlqAdminController`. Exposes only
 * `push`/`get`/`list`/`requeue`/`discard`/`remove`; the lease-based
 * `claim`/`release`/`complete`/`fail` primitives stay off this surface — see
 * {@link DlqAdminService}'s own JSDoc for why.
 */
export { DlqAdminService } from './dlq.service.ts'
/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/dlq`, backed by {@link DlqProvider}. A
 * future `DlqAggregator` in `@zanix/admin` (mirroring `TriggersAggregator`, not yet built) would
 * compose this the same way `defineAdminMetadata` composes `createTriggersDiscoveryProvider`; it
 * does not author the provider itself. Scoped to unresolved (`pending`/`claimed`/`failed`) entries
 * only — see this function's own JSDoc for why.
 */
export { createDlqDiscoveryProvider } from './dlq-discovery.provider.ts'

/** Registers `@zanix/datamaster`'s own DLQ model — required once before `DlqProvider` resolves. */
export {
  DEFAULT_DLQ_MODEL,
  defaultLeaseTtlMs,
  DLQ_DEFAULT_LEASE_MS_ENV,
  DLQ_ENCRYPT_PAYLOAD_ENV,
  DLQ_MODEL_ENV,
  dlqModelName,
  isDlqResourceEnabled,
  registerDlqModel,
} from './dlq.model.ts'
export type { RegisterDlqModelOptions } from './dlq.model.ts'

export type {
  DlqClaimOptions,
  DlqDiscardOptions,
  DlqEntryAttrs,
  DlqErrorHistoryEntry,
  DlqErrorInfo,
  DlqFailOptions,
  DlqLeaseOptions,
  DlqListOptions,
  DlqPushInput,
  DlqRequeueOptions,
  DlqStatus,
} from './dlq.typings.ts'
