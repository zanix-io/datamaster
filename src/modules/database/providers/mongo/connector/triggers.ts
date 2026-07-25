import type { TriggersModelAttrs } from 'database/typings/models.ts'
import type { ZanixMongoConnector } from './mod.ts'

import {
  getStaticTriggerEntries,
  resetPersistedTriggers,
  setDefaultSuppressed,
  setPersistedTriggers,
} from '../processor/triggers/registry.ts'
import { planTriggerSync } from '../processor/triggers/sync.ts'
import { registerTriggersModel } from '../defs/triggers.ts'
import { defineModels } from './models.ts'

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
 */
export async function loadPersistedTriggersOnStart(this: ZanixMongoConnector) {
  resetPersistedTriggers()
  if (!this.triggersModel) return

  const modelName = this.triggersModel

  registerTriggersModel(modelName)
  defineModels.call(this)

  const Model = this.getModel<TriggersModelAttrs>(modelName)
  const staticEntries = getStaticTriggerEntries()
  const existing = await Model.find({}).lean()

  const { toDelete, toResync, toSeed } = planTriggerSync(staticEntries, existing)

  if (toDelete.length) await Model.deleteMany({ _id: { $in: toDelete } })

  if (toResync.length) {
    await Promise.all(
      toResync.map(({ _id, triggers }) =>
        Model.updateOne({ _id }, { $set: { triggers, lastSyncedTriggers: triggers } })
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

  const current = (toDelete.length || toResync.length || toSeed.length)
    ? await Model.find({}).lean()
    : existing

  for (const entry of current) {
    if (entry.active) setPersistedTriggers(entry.model, entry.triggers)
    if (entry.isDefault) setDefaultSuppressed(entry.model)
  }

  this.triggersModel = false
}
