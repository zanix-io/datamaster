/** Lifecycle state of a persisted DLQ entry. See `dlq.provider.ts` for the exact transitions. */
export type DlqStatus =
  | 'pending'
  | 'claimed'
  | 'failed'
  | 'completed'
  | 'discarded'

/** Minimal error shape recorded for a DLQ entry — no `code`/arbitrary extra fields on purpose, to
 * keep the persisted shape stable regardless of the error class a caller happens to throw. */
export type DlqErrorInfo = {
  name: string
  message: string
  stack?: string
}

/** One historical failure snapshot, appended every time `fail()` is called. */
export type DlqErrorHistoryEntry = DlqErrorInfo & {
  /** When this failure was recorded. */
  occurredAt: Date
  /** The entry's `attempts` count at the moment this failure was recorded. */
  attempt: number
}

/**
 * Attributes for a persisted DLQ entry — the storage layer for "items that failed in some business
 * process," independent of `@zanix/asyncmq`'s own RabbitMQ-native dead-letter mechanism
 * (`ZanixAsyncMQProvider.requeueDeadLetters`). See `docs/dlq.md`.
 */
export type DlqEntryAttrs = {
  /** The entry's persisted id (Mongo's own `_id`, auto-assigned — never part of the schema
   * `definition` itself). */
  _id: string
  /** Logical type of the process/event that failed (e.g. `'payment.process'`). */
  processType: string
  /** Service/package that originated the failure. */
  origin: string
  /** Correlation id of the original process (job id, trace id) — for debugging/joining logs. */
  processId?: string
  /**
   * The original failed payload, in whatever shape the caller pushed. Persisted as a native `Mixed`
   * field by default — fully queryable via `list()`'s `filter` passthrough (e.g.
   * `{'payload.orderId': 'x'}`), unindexed. If `RegisterDlqModelOptions.encryptPayload` is enabled,
   * it's instead stored as a JSON-serialized, encrypted string — the underlying `encrypt`/`decrypt`
   * primitives (`utils/protection.ts`) only operate on `string | string[]`, so an encrypted payload
   * trades away queryability entirely (see `dlq.model.ts` and `docs/dlq.md`'s "Protecting the
   * payload" section). Either way, `push`/`get`/`list` always expose this as a plain value — the
   * storage-shape difference is transparent to callers.
   */
  payload: unknown
  /** The most recent error. */
  error: DlqErrorInfo
  /** Every recorded failure, oldest first — the current `error` is always its last entry. */
  errorHistory: DlqErrorHistoryEntry[]
  /** Number of times this entry has been claimed for (re)processing. */
  attempts: number
  /** Optional cap on `attempts` — once reached, `fail()` moves the entry to `'failed'` instead of
   * back to `'pending'`, requiring an explicit `requeue()` to become claimable again. Never
   * enforced automatically anywhere else (e.g. `claim()` doesn't check it). */
  maxAttempts?: number
  /** Current lifecycle state. */
  status: DlqStatus
  /** Free-form identifier of whoever currently holds the claim, set by `claim()`. */
  leaseOwner?: string
  /** When the current claim's lease expires — after this, the entry is claimable again even if
   * still `'claimed'` (the previous holder never called `release()`/`complete()`/`fail()`). */
  leaseExpiresAt?: Date
  /** Free-form additional context for debugging/recovery. */
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** Fields accepted by `DlqProvider.push()`. */
export type DlqPushInput = {
  processType: string
  origin: string
  processId?: string
  payload: unknown
  error: DlqErrorInfo
  maxAttempts?: number
  metadata?: Record<string, unknown>
}

/** Filters accepted by `DlqProvider.list()`, layered onto the shared `paginate` static's options. */
export type DlqListOptions = {
  processType?: string
  status?: DlqStatus
  origin?: string
  page?: number
  limit?: number
  sort?: Record<string, 1 | -1>
  /** Dot-path equality filter, merged alongside `processType`/`status`/`origin` — e.g. to query
   * into `payload`/`metadata` sub-fields. Any `$`-prefixed key is stripped before use, and
   * `processType`/`status`/`origin` always win over a same-named key here. Unindexed; see
   * `DlqProvider.list()`'s own doc. */
  filter?: Record<string, unknown>
}

/** Options for `DlqProvider.claim()`. */
export type DlqClaimOptions = {
  /** Free-form identifier of the caller claiming an entry — not a static worker "slot"; any
   * partitioning convention (e.g. `'asyncmq:pod-3'`) is entirely up to the caller. */
  leaseOwner: string
  /** Lease duration in ms. Defaults to `DLQ_DEFAULT_LEASE_MS` / the built-in default — see
   * `dlq.model.ts`'s `defaultLeaseTtlMs`. */
  leaseTtlMs?: number
  /** Restrict the claim to a single `processType`. */
  processType?: string
  /** Additional dot-path equality filter, merged with (never overriding) the claim's own
   * eligibility filter. Any `$`-prefixed key is stripped before use. */
  filter?: Record<string, unknown>
}

/** Options shared by every lease-fenced transition (`release`/`complete`/`fail`). */
export type DlqLeaseOptions = {
  /** Must match the entry's current `leaseOwner` — a mismatch throws `CONFLICT` rather than
   * silently overwriting another claimant's work. */
  leaseOwner: string
}

/** Options for `DlqProvider.fail()`. */
export type DlqFailOptions = DlqLeaseOptions & {
  error: DlqErrorInfo
}

/** Options for `DlqProvider.requeue()`. */
export type DlqRequeueOptions = {
  /** Reset `attempts` back to `0` in addition to moving the entry back to `'pending'`. */
  resetAttempts?: boolean
}

/** Options for `DlqProvider.discard()`. */
export type DlqDiscardOptions = {
  /** Recorded into `metadata.discardReason`, for audit purposes. */
  reason?: string
}
