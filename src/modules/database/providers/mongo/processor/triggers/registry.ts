import type { Triggers } from 'database/typings/triggers.ts'
import type { TriggersModelAttrs } from 'database/typings/models.ts'

const TIMINGS = ['pre', 'post'] as const
const EVENTS = ['created', 'updated', 'deleted'] as const

// Two separate layers, merged on read — not one accumulating map — so a fresh read of the
// persisted triggers collection (see `registerTriggersModel`) can fully REPLACE what a previous
// connector instance loaded for a model, instead of merging on top of possibly-stale data. This
// matters whenever more than one `ZanixMongoConnector` gets constructed in the same process (a
// real reconnect, or simply re-running tests) — without this separation, an entry that became
// inactive (or was deleted) in the database would keep dispatching forever, since nothing would
// ever remove it from a single ever-growing map.
//
// Nested by `connectorKey` (outer) → `modelName` (inner) — a connector only ever reads/resets its
// own bucket, never another connector's. Without this, a second `ZanixMongoConnector` booting
// would wipe the first's persisted layer via `resetPersistedTriggers` (see its own doc) — a real
// bug, confirmed with two real connectors on different slots *and* different URIs; same slot or
// same URI alone don't surface it, since either one keeps both connectors reading/resetting what's
// effectively the same underlying state.
const staticStore = new Map<string, Map<string, Triggers>>()
const persistedStore = new Map<string, Map<string, Triggers>>()

// Models whose static layer is fully replaced (not combined) by a persisted **default** entry —
// one auto-seeded from that same model's own static `extensions.triggers`. See
// {@link setDefaultSuppressed} for why this can't just be inferred from `persistedStore` alone.
// Nested by `connectorKey`, same reasoning as the two stores above.
const defaultSuppressed = new Map<string, Set<string>>()

/**
 * Combines two `Triggers` objects by concatenating their action arrays per `timing × event`
 * (e.g. both sets' `post.created` actions run, not just one).
 */
export const mergeTriggers = (base: Triggers, extra: Triggers): Triggers => {
  const merged: Triggers = {}

  for (const timing of TIMINGS) {
    const baseTypes = base[timing]
    const extraTypes = extra[timing]
    if (!baseTypes && !extraTypes) continue

    const mergedTypes: NonNullable<Triggers[typeof timing]> = {}
    for (const event of EVENTS) {
      const actions = [...(baseTypes?.[event] ?? []), ...(extraTypes?.[event] ?? [])]
      if (actions.length) mergedTypes[event] = actions
    }
    merged[timing] = mergedTypes
  }

  return merged
}

/**
 * Registers a model's static `extensions.triggers`, as configured in code — or clears any
 * previously-registered entry for it when called with none (`triggersMiddleware` calls this
 * unconditionally for every model, so this always reflects that model's CURRENT registration, not
 * whatever a possibly-stale prior registration for the same name left behind).
 *
 * Called once per model at schema-build time — before a database connection necessarily exists,
 * so it can only ever see the static configuration at that point. Kept in its own layer,
 * separate from whatever the persisted triggers collection later loads (see
 * {@link setPersistedTriggers}), so reloading the persisted side never discards this.
 *
 * @param connectorKey - The connector this model is bound to (`ZanixConnector.connectorKey`) — see
 * the module-level doc on why every store here is namespaced by it.
 */
export const setStaticTriggers = (
  connectorKey: string,
  modelName: string,
  triggers?: Triggers,
): void => {
  if (!triggers) {
    staticStore.get(connectorKey)?.delete(modelName)
    return
  }
  let store = staticStore.get(connectorKey)
  if (!store) staticStore.set(connectorKey, store = new Map())
  store.set(modelName, triggers)
}

/**
 * Returns every model name with a static `extensions.triggers` layer registered for `connectorKey`,
 * and that layer's triggers — used at connector startup to decide which models still need a
 * default persisted entry seeded for them (see `loadPersistedTriggersOnStart`).
 */
export const getStaticTriggerEntries = (connectorKey: string): Array<[string, Triggers]> => [
  ...(staticStore.get(connectorKey)?.entries() ?? []),
]

/**
 * Replaces a model's persisted-triggers layer (loaded from the persisted triggers collection —
 * see `registerTriggersModel`) with `triggers`, scoped to `connectorKey`.
 *
 * Call {@link resetPersistedTriggers} first, before loading the current set of active entries, so
 * a model whose entry became inactive (or was deleted) since the last load doesn't keep whatever
 * was set for it previously.
 */
export const setPersistedTriggers = (
  connectorKey: string,
  modelName: string,
  triggers: Triggers,
): void => {
  let store = persistedStore.get(connectorKey)
  if (!store) persistedStore.set(connectorKey, store = new Map())
  store.set(modelName, triggers)
}

/**
 * Marks a model's static `extensions.triggers` layer as permanently replaced by a persisted
 * **default** entry (`isDefault: true`, auto-seeded from that same static configuration), scoped
 * to `connectorKey`.
 *
 * Called for a default entry regardless of whether it's currently `active` — existence alone
 * means the model was already seeded once, so its static layer must stay retired even while the
 * entry is disabled; inferring suppression from {@link setPersistedTriggers} having been called
 * wouldn't work, since that only happens for currently-`active` entries.
 */
export const setDefaultSuppressed = (connectorKey: string, modelName: string): void => {
  let suppressed = defaultSuppressed.get(connectorKey)
  if (!suppressed) defaultSuppressed.set(connectorKey, suppressed = new Set())
  suppressed.add(modelName)
}

/**
 * Clears the persisted-triggers layer and default-suppression set for `connectorKey` only — call
 * this before reloading from that connector's persisted triggers collection, so the reload fully
 * reflects the database's current state (including entries that became inactive or were removed)
 * instead of merging on top of a previous, possibly-stale load. Never touches the static layer, and
 * never touches any *other* connector's buckets (this is what makes a second connector booting safe
 * — see the module-level doc).
 */
export const resetPersistedTriggers = (connectorKey: string): void => {
  persistedStore.delete(connectorKey)
  defaultSuppressed.delete(connectorKey)
}

/**
 * Returns a model's current effective triggers for `connectorKey`, or `undefined` if nothing
 * applies to it:
 *
 * - If the model has a persisted **default** entry (see {@link setDefaultSuppressed}) — one
 *   auto-seeded from its own static `extensions.triggers` — only the persisted triggers collection
 *   governs it from then on: its static layer is never read again, so editing or disabling that
 *   entry in the database fully controls the trigger without ever double-firing alongside the
 *   code definition it was seeded from.
 * - Otherwise, its static `extensions.triggers` combines with whatever the persisted triggers
 *   collection currently has active for it (a persisted entry created independently of any static
 *   configuration, e.g. via an admin endpoint, always just adds on top).
 *
 * Safe to call after the schema's hooks were already wired — hook bodies call this on every
 * invocation, not a snapshot taken at schema-build time, so either layer changing later (within
 * the rules above) takes effect without re-registering hooks.
 */
export const getTriggers = (connectorKey: string, modelName: string): Triggers | undefined => {
  const persistedTriggers = persistedStore.get(connectorKey)?.get(modelName)
  if (defaultSuppressed.get(connectorKey)?.has(modelName)) return persistedTriggers

  const staticTriggers = staticStore.get(connectorKey)?.get(modelName)
  if (!staticTriggers) return persistedTriggers
  if (!persistedTriggers) return staticTriggers

  return mergeTriggers(staticTriggers, persistedTriggers)
}

/** The minimal shape needed to re-read the persisted triggers collection. */
type TriggersModelLike = {
  find(filter: Record<string, never>): { lean(): Promise<TriggersModelAttrs[]> }
}

/**
 * Re-reads every entry in the persisted triggers collection and replaces `connectorKey`'s
 * in-memory persisted-triggers layer with it (via {@link resetPersistedTriggers} followed by
 * {@link setPersistedTriggers}/{@link setDefaultSuppressed} per active entry) — the shared
 * refresh operation behind the triggers model's post-write hooks (instant, same-process),
 * `triggersPollInterval` polling (a safety net for changes made elsewhere), and its Change Stream
 * watcher (near-instant, cross-replica, when available).
 *
 * Idempotent: calling it repeatedly against the same database state produces the same registry
 * state, so it's safe for more than one of those three sources to invoke it for the same
 * underlying write (e.g. a post-save hook and a Change Stream event both firing for one write
 * made through this process's own model).
 *
 * @param connectorKey - The connector this refresh belongs to — only its own bucket is reset.
 * @param Model - The bound triggers model (or anything with the same `find(...).lean()` shape).
 */
export const refreshPersistedTriggers = async (
  connectorKey: string,
  Model: TriggersModelLike,
): Promise<void> => {
  const entries = await Model.find({}).lean()

  resetPersistedTriggers(connectorKey)
  for (const entry of entries) {
    if (entry.active) setPersistedTriggers(connectorKey, entry.model, entry.triggers)
    if (entry.isDefault) setDefaultSuppressed(connectorKey, entry.model)
  }
}
