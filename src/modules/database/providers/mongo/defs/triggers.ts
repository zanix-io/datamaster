import type { TriggersModelAttrs } from 'database/typings/models.ts'

import { registerModel } from 'database/defs/models.ts'

/**
 * DSL function to define the persistent Triggers model — the storage layer for adding or
 * toggling triggers at runtime ("online adaptation"), as an alternative to the static
 * `extensions.triggers` declared in code via `registerModel`.
 *
 * Entries are read once per connector startup (see `loadPersistedTriggersOnStart`) — a trigger
 * added or toggled in this collection **after** the app has already connected only takes effect
 * on the next boot, not live. Reading/merging happens after the database connection is
 * established (schemas are built before that point, so they can't be read synchronously at
 * schema-build time), but hooks read the model's current effective triggers on every
 * invocation, so the merge still takes effect without re-registering hooks.
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
  })
}
