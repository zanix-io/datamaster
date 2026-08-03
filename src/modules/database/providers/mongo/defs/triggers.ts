// deno-lint-ignore-file no-explicit-any
import { refreshPersistedTriggers } from '../processor/triggers/registry.ts'
import ProgramModule from 'modules/program/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'
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
 *
 * A factory, not a plain function — `this` inside the hook is the Mongoose document/query, not the
 * connector, so `connectorKey` can't be read off `this`. `registerTriggersModel` builds one per
 * connector (it already has the resolved `connectorKey`), capturing it by closure — the same
 * pattern `seederProcessor` uses for its own connector-scoped hooks.
 */
const makeRefreshAfterSave = (connectorKey: string) =>
  async function refreshAfterSave(this: any, _doc: unknown, next: () => void): Promise<void> {
    try {
      await refreshPersistedTriggers(connectorKey, this.constructor)
    } catch (e) {
      logger.error('Failed to refresh persisted triggers after a write', e, 'noSave')
    }
    next()
  }

/** Query-level counterpart of {@link makeRefreshAfterSave} — see its doc for why `next` is
 * explicit and why this is a factory. */
const makeRefreshAfterQuery = (connectorKey: string) =>
  async function refreshAfterQuery(this: any, _result: unknown, next: () => void): Promise<void> {
    try {
      await refreshPersistedTriggers(connectorKey, this.model)
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
 * Registers directly against `ProgramModule.models` (bypassing the public `registerModel`, which
 * only accepts a connector *class*) since this runs from inside the connector itself, which already
 * has its own resolved `connectorKey` on `this` — see `ZanixConnector.connectorKey`.
 *
 * @param name - The name to register the persistent triggers model under.
 * @param connectorKey - The connector's own resolved key. Defaults to the default connector's key.
 */
export const registerTriggersModel = (
  name: string,
  connectorKey: string = DEFAULT_CONNECTOR_KEY,
) => {
  const refreshAfterSave = makeRefreshAfterSave(connectorKey)
  const refreshAfterQuery = makeRefreshAfterQuery(connectorKey)

  ProgramModule.models.addModel(
    {
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
    },
    'mongo',
    connectorKey,
  )
}
