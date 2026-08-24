import type { AdaptedModel } from 'database/mod.ts'
import type { ZanixMongoConnector } from 'database/mod.ts'
import type {
  DlqClaimOptions,
  DlqDiscardOptions,
  DlqEntryAttrs,
  DlqFailOptions,
  DlqLeaseOptions,
  DlqListOptions,
  DlqPushInput,
  DlqRequeueOptions,
} from './dlq.typings.ts'

import type { CoreModules } from '@zanix/server'

import { ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { transformByDataProtection } from 'mongo/processor/schema/transforms/data-policies.ts'
import { defaultLeaseTtlMs, dlqModelName } from './dlq.model.ts'
import { sanitizeMongoFilter } from './filter.ts'

/** Paginated `list()` result — same shape as the shared `paginate` static's own return value. */
export type DlqPaginatedResult = {
  docs: DlqEntryAttrs[]
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/** A boxed, decryptable `payloadRaw` value — what a hydrated document exposes when
 * `registerDlqModel`'s `encryptPayload` is enabled (see `createDecryptableObject`). */
type Decryptable = { decrypt(): Promise<string | string[]> }

const isDecryptable = (value: unknown): value is Decryptable =>
  typeof value === 'object' && value !== null &&
  typeof (value as Partial<Decryptable>).decrypt === 'function'

/**
 * Raw document shape actually stored — one of `payload` (native, unencrypted or per-field
 * protected via `RegisterDlqModelOptions.payloadFields`) or `payloadRaw` (whole-payload encrypted
 * via `encryptPayload`) is ever really present; both are typed here only because `push()` writes
 * both and lets Mongoose's own strict-mode schema binding silently drop whichever one the active
 * schema doesn't declare.
 */
type DlqDocument =
  & Omit<DlqEntryAttrs, 'payload' | '_id'>
  & { _id: unknown; payload?: unknown; payloadRaw?: string | Decryptable }

/** Reverses every registered data-protection path (`payloadRaw`, or any nested
 * `payload.<field>` declared via `payloadFields`) at once — see `dlq.provider.test.ts`/
 * `dlq.schema.test.ts` for the empirical verification this relies on. */
const dataProtectionTransform = transformByDataProtection()

/**
 * Maps a stored DLQ document to its public shape.
 *
 * A real hydrated Mongoose document with at least one protected path (`payloadRaw`, or a
 * `payloadFields`-declared nested leaf) goes through `transformByDataProtection` — the one
 * mechanism that correctly reverses protection at any depth, so `DlqProvider` never needs to know
 * which paths were declared protected or re-resolve `encryptPayload`/`payloadFields` itself. A doc
 * with no protection configured just needs `toObject()` to materialize a plain object at all (a
 * real hydrated document doesn't expose its schema fields as plain own-enumerable properties, so a
 * naive `{...doc}` would silently drop everything but `_id`). A plain fake/mocked doc (unit tests,
 * no real Mongoose schema behind it) falls through to the object itself, with a small duck-typed
 * fallback for a `payloadRaw` fixture simulating the encrypted getter directly.
 */
const toEntry = async (doc: DlqDocument): Promise<DlqEntryAttrs> => {
  // deno-lint-ignore no-explicit-any
  const anyDoc = doc as any
  const hasProtection = typeof anyDoc.toJSON === 'function' &&
    typeof anyDoc.schema?.statics?._hasDataProtection === 'function' &&
    anyDoc.schema.statics._hasDataProtection()

  let plain: Record<string, unknown>
  if (hasProtection) {
    const snapshot = anyDoc.toJSON({ getters: false, transform: false })
    plain = await dataProtectionTransform(anyDoc, snapshot) as Record<
      string,
      unknown
    >
  } else if (typeof anyDoc.toObject === 'function') {
    plain = anyDoc.toObject()
  } else {
    plain = anyDoc
    if (isDecryptable(plain.payloadRaw)) {
      plain = { ...plain, payloadRaw: await plain.payloadRaw.decrypt() }
    }
  }

  let payload: unknown
  if (plain.payload !== undefined) {
    payload = plain.payload
  } else if (plain.payloadRaw !== undefined) {
    payload = JSON.parse(plain.payloadRaw as string)
  }

  const { payload: _payload, payloadRaw: _payloadRaw, ...rest } = plain

  return { ...rest, _id: String(doc._id), payload } as DlqEntryAttrs
}

/**
 * Empty marker contract for the `'dlq'` core-provider slot (`dlq/core.ts`) — gives
 * `@Provider({ slot: 'dlq' })`'s `instanceof` check something to validate against, and gives a
 * future alternate storage backend a declared extension point to swap in for `DlqProvider`
 * (mirroring `ZanixDatabaseConnector`/`ZanixMongoConnector`'s own default-vs-contract split), same
 * pattern as `@zanix/auth`'s `ZanixCoreAuthProvider`/`@zanix/notifications`'
 * `ZanixCoreNotificationsProvider`. No behavior of its own — never instantiated directly.
 */
export class ZanixCoreDlqProvider<T extends CoreModules = object> extends ZanixProvider<T> {}

/**
 * Data access and lifecycle logic for `@zanix/datamaster`'s own persisted DLQ collection
 * (`zanix-dlq` by default, or `DLQ_MODEL_NAME`) — a Mongo-backed registry of items that failed in
 * some business process (payments, webhooks, jobs, ...), for auditing/debugging/manual or
 * programmatic retry. Independent of `@zanix/asyncmq`'s own RabbitMQ-native dead-letter mechanism
 * (`ZanixAsyncMQProvider.requeueDeadLetters`) — see `docs/dlq.md` for the distinction.
 *
 * Registered under the `'dlq'` core-provider slot (`dlq/core.ts`) — resolve it via
 * `this.providers.get(DlqProvider)` or `this.providers.get('dlq')`, both resolve the same
 * singleton. Requires `registerDlqModel()` to have run once during the app's own bootstrap.
 */
export class DlqProvider extends ZanixCoreDlqProvider<{ database: ZanixMongoConnector }> {
  /** Resolves the underlying DLQ `Model` once the connector is ready. */
  private async model(): Promise<AdaptedModel<DlqDocument>> {
    await this.database.isReady
    return this.database.getModel<DlqDocument>(dlqModelName())
  }

  /** Records a new failed item. Always starts `'pending'`, `attempts: 0`. */
  public async push(input: DlqPushInput): Promise<DlqEntryAttrs> {
    const Model = await this.model()
    const occurredAt = new Date()
    const payloadValue = input.payload ?? null

    // Writes both shapes unconditionally — safe regardless of `encryptPayload`, since Mongoose's
    // default strict-mode schema binding silently drops whichever of `payload`/`payloadRaw` the
    // active schema doesn't declare (see `dlq.model.ts`). This is what lets `DlqProvider` stay
    // agnostic to which mode is active, rather than re-resolving `encryptPayload` itself.
    const doc = await Model.create({
      processType: input.processType,
      origin: input.origin,
      processId: input.processId,
      payload: payloadValue,
      payloadRaw: JSON.stringify(payloadValue),
      error: input.error,
      errorHistory: [{ ...input.error, occurredAt, attempt: 0 }],
      attempts: 0,
      maxAttempts: input.maxAttempts,
      status: 'pending',
      metadata: input.metadata,
      // deno-lint-ignore no-explicit-any
    } as any)

    return toEntry(doc)
  }

  /**
   * Returns a single DLQ entry.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `id`.
   */
  public async get(id: string): Promise<DlqEntryAttrs> {
    const Model = await this.model()
    const doc = await Model.findOne({ _id: id })
    if (!doc) {
      throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
    }
    return toEntry(doc)
  }

  /**
   * Lists/paginates DLQ entries, optionally filtered by `processType`/`status`/`origin`, plus a raw
   * `filter` passthrough merged alongside those — e.g. `{ 'payload.orderId': 'abc123' }` or
   * `{ 'metadata.tenantId': 'x' }`, when `payload`/`metadata` aren't encrypted (see `docs/dlq.md`'s
   * "Protecting the payload" section — an encrypted `payload` isn't queryable this way). A dot-path
   * equality lookup only: any `$`-prefixed key in `filter`, at any nesting level, is stripped (see
   * `sanitizeMongoFilter`) before it reaches the query — `filter` isn't a place to hand this a raw
   * Mongo operator, and `processType`/`status`/`origin` always win over a same-named `filter` key.
   * Unindexed: a hot ad hoc query path should get its own `schema.index()` via a custom connector,
   * or promote the field to a real top-level column instead.
   */
  public async list(options: DlqListOptions = {}): Promise<DlqPaginatedResult> {
    const Model = await this.model()
    const {
      processType,
      status,
      origin,
      page,
      limit,
      sort,
      filter: rawFilter,
    } = options

    const filter: Record<string, unknown> = sanitizeMongoFilter(rawFilter)
    if (processType) filter.processType = processType
    if (status) filter.status = status
    if (origin) filter.origin = origin

    const result = await Model.paginate({ filter, page, limit, sort })
    const docs = await Promise.all(
      result.docs.map((doc) => toEntry(doc as unknown as DlqDocument)),
    )

    return { ...result, docs }
  }

  /**
   * Atomically claims one eligible entry for processing — either genuinely `'pending'`, or
   * `'claimed'` with an expired lease (an abandoned claim, e.g. a worker that crashed mid-processing
   * without calling `release()`/`complete()`/`fail()`) — never `'failed'`/`'completed'`/`'discarded'`.
   * The primitive that makes concurrent processing across multiple instances safe, without any
   * static worker/slot partitioning (see `docs/dlq.md`'s "Concurrency" section): `findOneAndUpdate`
   * is atomic at the document level, so two concurrent `claim()` calls can never both succeed
   * against the same entry.
   *
   * Returns `null` when nothing is eligible — never throws for "nothing to claim."
   *
   * `options.filter` is a dot-path equality lookup, additive to this method's own eligibility
   * filter — never a way to widen or replace it. `sanitizeMongoFilter` strips any `$`-prefixed key
   * from it first (at any nesting level), and it's merged *before* `status`/`$or`/`processType` so
   * none of those can be overridden by a same-named `filter` key either.
   */
  public async claim(options: DlqClaimOptions): Promise<DlqEntryAttrs | null> {
    const Model = await this.model()
    const now = new Date()
    const leaseTtlMs = options.leaseTtlMs ?? defaultLeaseTtlMs()

    const filter: Record<string, unknown> = {
      ...sanitizeMongoFilter(options.filter),
      status: { $in: ['pending', 'claimed'] },
      $or: [{ leaseExpiresAt: { $exists: false } }, {
        leaseExpiresAt: { $lt: now },
      }],
      ...(options.processType ? { processType: options.processType } : {}),
    }

    const doc = await Model.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'claimed',
          leaseOwner: options.leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    )

    return doc ? toEntry(doc) : null
  }

  /**
   * Releases a claim early (e.g. on consumer shutdown) without waiting out the lease TTL, moving
   * the entry back to `'pending'`.
   *
   * @throws {HttpError} `CONFLICT` if `leaseOwner` doesn't match the entry's current claim (already
   * released, reclaimed by someone else, or never claimed) — never silently no-ops.
   */
  public release(id: string, options: DlqLeaseOptions): Promise<DlqEntryAttrs> {
    return this.transitionLeasedEntry(id, options.leaseOwner, {
      $set: { status: 'pending' },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    })
  }

  /**
   * Marks a claimed entry as successfully processed — a terminal state.
   *
   * @throws {HttpError} `CONFLICT` if `leaseOwner` doesn't match the entry's current claim.
   */
  public complete(
    id: string,
    options: DlqLeaseOptions,
  ): Promise<DlqEntryAttrs> {
    return this.transitionLeasedEntry(id, options.leaseOwner, {
      $set: { status: 'completed' },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    })
  }

  /**
   * Records a new processing failure for a claimed entry. Moves back to `'pending'` (eligible for
   * another `claim()`) unless `maxAttempts` has been reached, in which case it moves to `'failed'`
   * (requires an explicit `requeue()` to become claimable again).
   *
   * @throws {HttpError} `CONFLICT` if `leaseOwner` doesn't match the entry's current claim.
   */
  public async fail(
    id: string,
    options: DlqFailOptions,
  ): Promise<DlqEntryAttrs> {
    const Model = await this.model()

    // Read first to decide the next status from the current `attempts`/`maxAttempts` — the actual
    // mutation below is still fenced by the same `{_id, leaseOwner, status:'claimed'}` filter, so a
    // stale read here can at worst pick the "wrong" terminal-vs-retriable status, never corrupt or
    // double-apply the transition itself.
    const current = await Model.findOne({
      _id: id,
      leaseOwner: options.leaseOwner,
      status: 'claimed',
    })
    if (!current) {
      throw new HttpError('CONFLICT', {
        meta: {
          id,
          source: 'zanix',
          reason: 'No active claim matches the given leaseOwner.',
        },
      })
    }

    const nextStatus = current.maxAttempts && current.attempts >= current.maxAttempts
      ? 'failed'
      : 'pending'

    return this.transitionLeasedEntry(id, options.leaseOwner, {
      $set: { status: nextStatus, error: options.error },
      $push: {
        errorHistory: {
          ...options.error,
          occurredAt: new Date(),
          attempt: current.attempts,
        },
      },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    })
  }

  /**
   * Forces an entry back to `'pending'` regardless of `maxAttempts` — manual/administrative retry,
   * distinct from the automatic `'pending'` transition `fail()` performs while attempts remain.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `id`.
   */
  public async requeue(
    id: string,
    options: DlqRequeueOptions = {},
  ): Promise<DlqEntryAttrs> {
    const Model = await this.model()
    const doc = await Model.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          status: 'pending',
          ...(options.resetAttempts ? { attempts: 0 } : {}),
        },
        $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
      },
      { new: true },
    )
    if (!doc) {
      throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
    }
    return toEntry(doc)
  }

  /**
   * Permanently closes an entry without deleting it (preserved for audit) — distinct from
   * {@link remove}. Doesn't require an active lease: this is an administrative action.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `id`.
   */
  public async discard(
    id: string,
    options: DlqDiscardOptions = {},
  ): Promise<DlqEntryAttrs> {
    const Model = await this.model()
    const doc = await Model.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          status: 'discarded',
          ...(options.reason ? { 'metadata.discardReason': options.reason } : {}),
        },
        $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
      },
      { new: true },
    )
    if (!doc) {
      throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
    }
    return toEntry(doc)
  }

  /**
   * Permanently deletes an entry — for retention/cleanup, always manual in v1 (no TTL/auto-purge).
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `id`.
   */
  public async remove(id: string): Promise<void> {
    const Model = await this.model()
    const result = await Model.deleteOne({ _id: id })
    if (!result.deletedCount) {
      throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
    }
  }

  /** Shared implementation for every lease-fenced transition (`release`/`complete`/`fail`). */
  private async transitionLeasedEntry(
    id: string,
    leaseOwner: string,
    // deno-lint-ignore no-explicit-any
    update: Record<string, any>,
  ): Promise<DlqEntryAttrs> {
    const Model = await this.model()
    const doc = await Model.findOneAndUpdate(
      { _id: id, leaseOwner, status: 'claimed' },
      update,
      { new: true },
    )
    if (!doc) {
      throw new HttpError('CONFLICT', {
        meta: {
          id,
          source: 'zanix',
          reason: 'No active claim matches the given leaseOwner.',
        },
      })
    }
    return toEntry(doc)
  }
}
