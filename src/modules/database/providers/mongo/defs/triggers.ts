// deno-lint-ignore-file no-explicit-any
import type { TriggersModelAttrs } from 'database/typings/models.ts'

import { refreshPersistedTriggers } from '../processor/triggers/registry.ts'
import { registerModel } from 'database/defs/models.ts'
import logger from '@zanix/logger'

/**
 * Refreshes the in-memory persisted-triggers registry (see {@link refreshPersistedTriggers}) right
 * after a write commits to the triggers collection — the instant, same-process leg of "online
 * adaptation" (the other two are `triggersPollInterval` polling and a `triggersChangeStream`
 * watcher, both configured on the connector; see `loadPersistedTriggersOnStart`). Never rejects the
 * write itself: a refresh failure is logged, not thrown, since the write already succeeded.
 *
 * Declared with an explicit second parameter (rather than a rest/no-arg signature) on purpose —
 * Mongoose decides whether to pass a `next` callback based on the handler's declared arity
 * (`fn.length`); a rest-param signature reports `length === 0` and Mongoose never supplies `next`
 * at all, which would make `next()` below throw.
 */
async function refreshAfterSave(this: any, _doc: unknown, next: () => void): Promise<void> {
  try {
    await refreshPersistedTriggers(this.constructor)
  } catch (e) {
    logger.error('Failed to refresh persisted triggers after a write', e, 'noSave')
  }
  next()
}

/** Query-level counterpart of {@link refreshAfterSave} — see its doc for why `next` is explicit. */
async function refreshAfterQuery(this: any, _result: unknown, next: () => void): Promise<void> {
  try {
    await refreshPersistedTriggers(this.model)
  } catch (e) {
    logger.error('Failed to refresh persisted triggers after a write', e, 'noSave')
  }
  next()
}

/**
 * DSL function to define the persistent Triggers model — the storage layer for adding or
 * toggling triggers at runtime ("online adaptation"), as an alternative to the static
 * `extensions.triggers` declared in code via `registerModel`.
 *
 * Entries are read once per connector startup (see `loadPersistedTriggersOnStart`), which also
 * starts two opt-in ongoing refresh mechanisms (`triggersPollInterval` polling and a
 * `triggersChangeStream` watcher). On top of those, this model's own schema gets post-save/
 * update/delete hooks (see {@link refreshAfterSave}/{@link refreshAfterQuery}) that refresh the
 * registry instantly for any write made through this connector's own model — the only leg of
 * "online adaptation" that's always on, requiring no configuration.
 *
 * @param name - The name to register the persistent triggers model under.
 */
export const registerTriggersModel = (name: string) => {
  registerModel<TriggersModelAttrs>({
    name,
    definition: {
      model: { type: String, required: true, unique: true },
      active: { type: Boolean, default: true },
      triggers: { type: Object, required: true },
      isDefault: { type: Boolean, default: false },
      lastSyncedTriggers: { type: Object },
    },
    options: {
      timestamps: true,
    },
    callback: (schema) => {
      schema.post('save', refreshAfterSave)
      schema.post(
        ['updateOne', 'findOneAndUpdate'],
        { document: false, query: true },
        refreshAfterQuery,
      )
      schema.post(
        ['deleteOne', 'findOneAndDelete'],
        { document: false, query: true },
        refreshAfterQuery,
      )
      return schema
    },
  })
}
