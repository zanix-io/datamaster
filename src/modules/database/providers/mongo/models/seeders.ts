import { defineModelHOC } from 'database/hocs/models.ts'

export type SeedModelAttrs = {
  name: string
  status: 'success' | 'failed'
  version: `${number}.${number}.${number}`
  duration?: number
  notes?: string
}

/**
 * HOC to define Seed Model
 * @param name  - Seed Model Name
 */
export const defineSeedModel = (name: string) => {
  defineModelHOC<SeedModelAttrs>({
    name,
    definition: {
      name: { type: String, required: true, indexes: true },
      version: { type: String, default: '0.0.0' },
      status: { type: String, enum: ['success', 'failed'] },
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
