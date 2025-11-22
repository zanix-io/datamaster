import type { SeedModelAttrs } from 'database/typings/models.ts'

import { registerModel } from 'database/defs/models.ts'

/**
 * DSL function to define Seed Model
 * @param name  - Seed Model Name
 */
export const registerSeedModel = (name: string) => {
  registerModel<SeedModelAttrs>({
    name,
    definition: {
      name: { type: String, required: true, indexes: true },
      version: { type: String, default: '0.0.0' },
      status: { type: String, enum: ['success', 'failed'] },
      executedBy: String,
      duration: Number,
      notes: String,
    },
    options: {
      timestamps: { updatedAt: false },
      versionKey: false,
    },
    callback: (schema) => {
      schema.index({ version: 1, name: 1, status: 1 }, { unique: true }) // covered query
      return schema
    },
  })
}
