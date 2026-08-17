import ProgramModule from 'modules/program/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/**
 * DSL function to define the internal seed-tracking model.
 *
 * Registers directly against `ProgramModule.models` (bypassing the public `registerModel`, which
 * only accepts a connector *class*) since this runs from inside the connector itself, which already
 * has its own resolved `connectorKey` on `this` — see `ZanixConnector.connectorKey`.
 *
 * @param name  - Seed Model Name
 * @param connectorKey - The connector's own resolved key. Defaults to the default connector's key.
 */
export const registerSeedModel = (
  name: string,
  connectorKey: string = DEFAULT_CONNECTOR_KEY,
) => {
  ProgramModule.models.addModel(
    {
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
    },
    'mongo',
    connectorKey,
  )
}
