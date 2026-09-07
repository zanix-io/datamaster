import type { ZanixMongoConnector } from './mod.ts'

import { isDlqModelRegistered, isDlqResourceEnabled, registerDlqModel } from 'dlq/dlq.model.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/**
 * Auto-registers `@zanix/datamaster`'s own DLQ model (see `dlq/dlq.model.ts`'s `registerDlqModel`)
 * against the default Mongo connector, so that setting `DLQ_MODEL_NAME` alone — without a separate
 * explicit `registerDlqModel()` call in the app's own bootstrap — is enough to get the DLQ
 * collection registered. Unlike `triggers.ts`'s `loadPersistedTriggersOnStart`, this only needs to
 * run *before* the connector's first `defineModels()` pass (see `mod.ts`'s `initialize()`) — DLQ
 * registration is just an in-memory schema registration (`registerModel`), not a query against an
 * already-connected collection, so there's no need for triggers' own post-`connect()` timing or a
 * second `defineModels()` pass.
 *
 * Three guards, all required, none shared with `loadPersistedTriggersOnStart` (triggers is
 * genuinely per-connector and on-by-default; DLQ is neither):
 *
 * 1. **Opt-in only** — gated on {@link isDlqResourceEnabled} (`DLQ_MODEL_NAME` set, directly or via
 *    the equivalent `@zanix/core` setup option that sets that same env var). An app that never
 *    configured DLQ gets nothing registered, unlike triggers' on-by-default model.
 * 2. **Default connector only** — gated on `this.resolvedConnectorKey === DEFAULT_CONNECTOR_KEY`.
 *    DLQ is a single, app-global resource (one queue), not a genuinely per-connector one like
 *    triggers — auto-registering it against every active connector in a multi-connector app would
 *    produce duplicate/conflicting registrations, exactly the risk `registerDlqModel`'s own doc
 *    already flags. An app that wants DLQ hosted on a non-default connector still needs its own
 *    explicit `registerDlqModel(options, connector)` call — this hook never targets one.
 * 3. **Never overrides an explicit call** — gated on `!`{@link isDlqModelRegistered}. An app that
 *    already called `registerDlqModel(options)` itself during its own bootstrap (which runs before
 *    `Zanix.start()` instantiates connectors) keeps whatever `options` it passed; this hook must
 *    never call `registerDlqModel()` a second time, which would silently re-register with only the
 *    env vars in effect and discard options like `payloadFields` that have no env var equivalent.
 *
 * Requires an actual instance in the default Mongo connector slot to exist at all for any of this
 * to run — either `MONGO_URI` set (so `registerMongoConnector()`'s own `core.ts` auto-installs one),
 * or an app's own `@Connector('database') class extends ZanixMongoConnector {}` (which doesn't
 * itself depend on `MONGO_URI` for the slot registration, only for the connector's own connection
 * string). This isn't a new limitation the auto-hook introduces: any app that sets `DLQ_MODEL_NAME`
 * because it wants the (Mongo-backed) DLQ module already needs a real Mongo connection through one
 * of those two paths regardless of this hook's existence. The symmetric edge case — an app running
 * entirely on custom connectors in slots other than `'database'`, with no instance in the default
 * slot at all — means the auto-hook never fires even with `DLQ_MODEL_NAME` set; that's the same
 * limit `registerDlqModel()` already has without an explicit `connector` argument, not a regression.
 */
export function autoRegisterDlqModelOnStart(this: ZanixMongoConnector): void {
  if (this.resolvedConnectorKey !== DEFAULT_CONNECTOR_KEY) return
  if (isDlqModelRegistered()) return
  if (!isDlqResourceEnabled()) return

  registerDlqModel()
}
