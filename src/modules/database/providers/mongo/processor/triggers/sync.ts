// deno-lint-ignore-file no-explicit-any
import type { Triggers } from 'database/typings/triggers.ts'

import { planCodeSync } from '@zanix/helpers'

/**
 * Structural equality for plain JSON-shaped values (the `Triggers` configuration is always one:
 * strings, numbers, booleans, arrays, and plain objects) — used to detect whether a persisted
 * default entry's `triggers` still matches what code last synced into it, or was edited directly.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (
    typeof a !== 'object' || typeof b !== 'object' || a === null || b === null
  ) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((item, index) => deepEqual(item, b[index]))
  }

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  return aKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) &&
    deepEqual((a as any)[key], (b as any)[key])
  )
}

/** A persisted triggers entry, as read back from the database, relevant to sync planning. */
export type ExistingTriggerEntry = {
  _id: unknown
  model: string
  isDefault: boolean
  triggers: Triggers
  lastSyncedTriggers?: Triggers
}

/** What a default-sync pass at connector startup should do to the persisted triggers collection. */
export type TriggerSyncPlan = {
  /** `_id`s of default entries whose model no longer declares `extensions.triggers` in code. */
  toDelete: unknown[]
  /** Default entries whose content should be overwritten with the model's current code triggers. */
  toResync: Array<{ _id: unknown; triggers: Triggers }>
  /** Models with a static trigger layer that have no persisted entry at all yet. */
  toSeed: Array<{ model: string; triggers: Triggers }>
}

/**
 * Plans how the persisted triggers collection should reconcile with the current code state, pure
 * of any database access (called with data already read, and only decides — never performs — the
 * writes) so it's independently testable:
 *
 * - **Orphaned** (a default entry whose model no longer has ANY static `extensions.triggers`) →
 *   deleted entirely, since the code that seeded it no longer exists.
 * - **Changed in code, untouched in the database** (a default entry whose `triggers` still equals
 *   `lastSyncedTriggers` — nobody edited it directly — but the model's current static triggers
 *   differ from that) → re-synced to the new code content.
 * - **Changed in code, but also edited directly** (`triggers` no longer equals
 *   `lastSyncedTriggers`) → left alone; a manual edit always wins over a later code change.
 * - **Not yet persisted at all** (a model with static triggers and no entry, default or not) →
 *   seeded fresh.
 *
 * Non-default entries (`isDefault: false`) are never orphaned/resynced by any of this — they're
 * unrelated to any static code configuration — but they DO still count against `toSeed`: a model
 * with only a custom entry never gets a duplicate default one auto-seeded on top of it.
 *
 * The actual reconciliation (orphan/resync detection via the "does the live value still match
 * what code last synced in" mirror-field check) is `@zanix/helpers`' `planCodeSync` — shared with
 * `@zanix/notifications`' own code-to-database template sync, the other real consumer of this
 * exact algorithm.
 */
export const planTriggerSync = (
  staticEntries: Array<[string, Triggers]>,
  existing: ExistingTriggerEntry[],
): TriggerSyncPlan => {
  const defaultEntries = existing.filter((entry) => entry.isDefault)
  const allExistingModels = new Set(existing.map((entry) => entry.model))

  const plan = planCodeSync<Triggers>(
    staticEntries.map(([model, triggers]) => ({ key: model, value: triggers })),
    defaultEntries.map((entry) => ({
      _id: entry._id,
      key: entry.model,
      value: entry.triggers,
      lastSyncedValue: entry.lastSyncedTriggers,
    })),
    deepEqual,
  )

  return {
    toDelete: plan.toOrphan.map((entry) => entry._id),
    toResync: plan.toResync.map((entry) => ({
      _id: entry._id,
      triggers: entry.value,
    })),
    toSeed: staticEntries
      .filter(([model]) => !allExistingModels.has(model))
      .map(([model, triggers]) => ({ model, triggers })),
  }
}
