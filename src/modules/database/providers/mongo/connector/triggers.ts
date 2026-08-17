import type { TriggersModelAttrs } from 'database/typings/models.ts'
import type { ZanixMongoConnector } from './mod.ts'

import {
  getStaticTriggerEntries,
  refreshPersistedTriggers,
  resetPersistedTriggers,
} from '../processor/triggers/registry.ts'
import { planTriggerSync } from '../processor/triggers/sync.ts'
import { registerTriggersModel } from '../defs/triggers.ts'
import { defineModels } from './models.ts'
import logger from '@zanix/logger'

/**
 * Extends the ZanixMongoConnector to load the persisted triggers collection (if enabled via
 * `triggersModel`) and set each of its `active` entries as the corresponding target model's
 * persisted-triggers layer (see `setPersistedTriggers`).
 *
 * A **default** entry (`isDefault: true`) fully replaces its target model's static
 * `extensions.triggers` instead of combining with it (see `getTriggers`) — and every model with a
 * static trigger layer that doesn't have ANY persisted entry yet (default or not) gets one
 * auto-seeded here, `active: true`, mirroring its static configuration exactly. This is what makes
 * a code-defined trigger editable/disableable from the database: once seeded, that model's static
 * layer never fires directly again, so there's no risk of it double-firing alongside the entry it
 * was seeded from. Deleting the seeded entry doesn't stick — the next boot re-seeds it fresh from
 * whatever the code currently declares, since seeding only happens when no entry exists at all;
 * `active: false` is the only way to durably turn it off.
 *
 * A default entry also stays in sync with its model's code on every boot (see
 * {@link planTriggerSync} for the exact rules): deleted if the code no longer declares
 * `extensions.triggers` for that model at all, or re-synced if the code's content changed and
 * nobody edited `triggers` directly since the last sync. An entry that WAS edited directly is left
 * alone regardless of code changes — a manual edit always wins.
 *
 * Runs once per connector, after the database connection is established (schemas — and their
 * static `extensions.triggers` — are already built by that point, since that happens before
 * `connect()`; hooks read the merged result on every invocation, so this still takes effect).
 * Resets the persisted layer and the default-suppression set for **every** model FIRST — even when
 * `triggersModel` is disabled — so this connector never inherits stale state a previous connector
 * (in the same process) loaded into these module-level stores; without that, a connector built
 * with `triggersModel: false` wouldn't reliably mean "only code triggers" whenever an earlier
 * connector had already loaded persisted entries.
 *
 * After this initial load, three complementary mechanisms keep the in-memory registry from going
 * stale without a redeploy — see {@link refreshPersistedTriggers}, the shared operation behind
 * all three:
 *
 * 1. **The triggers model's own post-save/update/delete hooks** (see `registerTriggersModel`) —
 *    always on, refreshes instantly for any write made through this connector's own model (e.g.
 *    an admin endpoint in this same app calling `TriggersModel.updateOne(...)`).
 * 2. **Polling** (see {@link startTriggersPolling}) — opt-in via `triggersPollInterval`, a safety
 *    net for writes this process can't otherwise see (a separate service, another replica, a
 *    direct database edit).
 * 3. **A Change Stream watcher** (see {@link startTriggersChangeStream}) — opt-in via
 *    `triggersChangeStream`, near-instant and cross-replica, but requires a replica set/sharded
 *    cluster.
 */
export async function loadPersistedTriggersOnStart(this: ZanixMongoConnector) {
  resetPersistedTriggers(this.resolvedConnectorKey)
  if (!this.triggersModel) return

  const modelName = this.triggersModel

  registerTriggersModel(modelName, this.resolvedConnectorKey)
  defineModels.call(this)

  const Model = this.getModel<TriggersModelAttrs>(modelName)
  const staticEntries = getStaticTriggerEntries(this.resolvedConnectorKey)
  const existing = await Model.find({}).lean()

  const { toDelete, toResync, toSeed } = planTriggerSync(
    staticEntries,
    existing,
  )

  if (toDelete.length) await Model.deleteMany({ _id: { $in: toDelete } })

  if (toResync.length) {
    await Promise.all(
      toResync.map(({ _id, triggers }) =>
        Model.updateOne({ _id }, {
          $set: { triggers, lastSyncedTriggers: triggers },
        })
      ),
    )
  }

  if (toSeed.length) {
    await Model.insertMany(
      toSeed.map(({ model, triggers }) => ({
        model,
        active: true,
        triggers,
        isDefault: true,
        lastSyncedTriggers: triggers,
      })),
    )
  }

  await refreshPersistedTriggers(this.resolvedConnectorKey, Model)

  this.triggersModel = false

  startTriggersPolling.call(this, Model)
  startTriggersChangeStream.call(this, Model)
}

/**
 * Starts polling the persisted triggers collection every `triggersPollInterval` milliseconds,
 * calling {@link refreshPersistedTriggers} on each tick. A no-op unless `triggersPollInterval` was
 * set to a positive number.
 *
 * Self-reschedules with `setTimeout` (stored on `triggersPoll.timer`, cleared by `close()`) rather
 * than `setInterval`, so a slow tick can never overlap with the next one. A tick that fails (e.g. a
 * transient connection error) is logged but never stops future polling.
 *
 * Checks `triggersPoll.stopped` right before rescheduling, not just at the top of `tick` — a tick
 * already past that check when `close()` runs would otherwise still schedule one more timer via
 * `.finally()` *after* `close()`'s own `clearTimeout` already ran, leaking a poll against an
 * already-closed connection.
 *
 * @param Model - The bound triggers model to re-read on every tick.
 */
function startTriggersPolling(
  this: ZanixMongoConnector,
  Model: Parameters<typeof refreshPersistedTriggers>[1],
): void {
  const interval = this.triggersPollInterval
  if (!interval) return

  const connectorKey = this.resolvedConnectorKey

  const tick = () => {
    refreshPersistedTriggers(connectorKey, Model)
      .catch((e) =>
        logger.error(
          'Failed to poll the persisted triggers collection',
          e,
          'noSave',
        )
      )
      .finally(() => {
        if (this.triggersPoll.stopped) return
        this.triggersPoll.timer = setTimeout(tick, interval)
      })
  }

  this.triggersPoll.timer = setTimeout(tick, interval)
}

/**
 * Starts watching the persisted triggers collection via a MongoDB Change Stream, calling
 * {@link refreshPersistedTriggers} the instant any write is committed to it — including writes
 * from other processes/replicas, without waiting for `triggersPollInterval`. A no-op unless
 * `triggersChangeStream` is `true`.
 *
 * Change Streams require a replica set or sharded cluster. `Model.watch()` throws synchronously
 * against a standalone instance — that failure (and any later stream `'error'` event) is caught
 * and logged as a warning instead of failing connector startup; the poll/on-write refresh paths
 * keep working regardless.
 *
 * @param Model - The bound triggers model to watch.
 */
function startTriggersChangeStream(
  this: ZanixMongoConnector,
  Model: Parameters<typeof refreshPersistedTriggers>[1] & {
    watch: () => {
      on: (event: 'change' | 'error', listener: (arg: unknown) => void) => void
      close: () => Promise<void>
    }
  },
): void {
  if (!this.triggersChangeStream) return

  const connectorKey = this.resolvedConnectorKey

  try {
    const stream = Model.watch()

    stream.on(
      'change',
      () =>
        void refreshPersistedTriggers(connectorKey, Model).catch((e) =>
          logger.error(
            'Failed to refresh persisted triggers from change stream',
            e,
            'noSave',
          )
        ),
    )
    stream.on(
      'error',
      (e) => logger.error('Persisted triggers change stream error', e, 'noSave'),
    )

    this.triggersChangeStreamHandle = stream
  } catch (e) {
    logger.warn(
      'Could not start a Change Stream for persisted triggers — this requires a replica set or ' +
        'sharded cluster. Falling back to on-write and/or polling-based refresh only.',
      e,
      'noSave',
    )
  }
}
