import type { SeederProcessor } from 'database/typings/general.ts'

import ProgramModule from 'modules/program/mod.ts'

const getName = (modelName: string, seederName?: string) => `${modelName}:${seederName}`
const getDbAndModel = (model: string) => {
  const [modelOrDb, modelName] = model.split(':')
  if (modelName) return { database: modelOrDb, model: modelName }
  return { model: modelOrDb }
}

/** Mongo seeder process on handler execution */
// deno-lint-ignore no-explicit-any
export function seederProcessor(modelName: (model: any) => string): SeederProcessor {
  return {
    prepare: (version, name, Model) => {
      const { database, model } = getDbAndModel(modelName(Model))
      const toFind = { name: getName(model, name), status: 'success', version }
      ProgramModule.seeders.addDataToQuery({ data: toFind, action: 'find', database })
    },
    avoidRun: (version, name, Model) => {
      const { model } = getDbAndModel(modelName(Model))
      return ProgramModule.seeders.existInDB.has(getName(model, name) + '@' + version)
    },
    onFinish: (status, options, Model) => {
      const { name, version, duration } = options
      const { database, model } = getDbAndModel(modelName(Model))
      const toSave = { name: getName(model, name), status, version, duration }

      ProgramModule.seeders.addDataToQuery({ data: toSave, action: 'save', database })
    },
  }
}
