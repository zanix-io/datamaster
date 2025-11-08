import type { SeederProcessor } from 'database/typings/general.ts'

import ProgramModule from 'modules/program/mod.ts'

/** Mongo seeder process on handler execution */
export function mongoSeederProcessor(): SeederProcessor {
  const getName = (model: string, name?: string) => `${model}:${name}`
  return {
    prepare: (version, name, model) => {
      const toFind = {
        name: getName(model.modelName || model.name, name),
        status: 'success',
        version,
      }
      ProgramModule.seeders.addDataToQuery(toFind, 'find')
    },
    avoidRun: (version, name, Model) => {
      return ProgramModule.seeders.existInDB.has(getName(Model.modelName, name) + '@' + version)
    },
    onFinish: (status, options, Model) => {
      const { name, version, duration } = options
      const toSave = { name: getName(Model.modelName, name), status, version, duration }

      ProgramModule.seeders.addDataToQuery(toSave, 'save')
    },
  }
}
