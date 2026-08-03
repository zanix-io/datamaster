import type { SeederProcessor } from 'database/typings/general.ts'

import ProgramModule from 'modules/program/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

const getName = (modelName: string, seederName?: string) => `${modelName}:${seederName}`
const getDbAndModel = (model: string) => {
  const [modelOrDb, modelName] = model.split(':')
  if (modelName) return { database: modelOrDb, model: modelName }
  return { model: modelOrDb }
}

/** Mongo seeder process on handler execution */
export function seederProcessor(
  // deno-lint-ignore no-explicit-any
  modelName: (model: any) => string,
  connectorKey: string = DEFAULT_CONNECTOR_KEY,
): SeederProcessor {
  return {
    prepare: (version, name, Model) => {
      const { database, model } = getDbAndModel(modelName(Model))
      const toFind = { name: getName(model, name), status: 'success', version }
      ProgramModule.seeders.addDataToQuery({ data: toFind, action: 'find', database, connectorKey })
    },
    avoidRun: (version, name, Model) => {
      const { model } = getDbAndModel(modelName(Model))
      return ProgramModule.seeders.existInDB.has(
        `${connectorKey}:${getName(model, name)}@${version}`,
      )
    },
    onFinish: (status, options, Model) => {
      const { name, version, duration } = options
      const { database, model } = getDbAndModel(modelName(Model))
      const toSave = { name: getName(model, name), status, version, duration }

      ProgramModule.seeders.addDataToQuery({ data: toSave, action: 'save', database, connectorKey })
    },
  }
}
