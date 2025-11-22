import type { SeederHandler } from 'database/typings/general.ts'
import type { ZanixMongoConnector } from './mod.ts'
import type { Seeders } from '@zanix/server'

import { seederAdaptation } from 'database/utils/seeders/adaptation.ts'
import ProgramModule from 'modules/program/mod.ts'
import { defineSeedModelOnce } from './models.ts'
import logger from '@zanix/logger'

const seederErrorMsg =
  `Verify configuration settings and ensure there are no duplicated seeder names.`

/**
 * Function to run and save seeders
 */
async function runAndSaveSeeders(this: ZanixMongoConnector, seeders: Seeders) {
  const Models = await defineSeedModelOnce.call(this) // execute before run seeders to prepare existInDB

  await this.runSeeders(seeders)

  if (!Models) return ProgramModule.seeders.deleteSeeders()

  const dataToSave = ProgramModule.seeders.consumeDataToQuery('save')
  await Promise.all(
    Object.entries(dataToSave).map(async ([db, data]) => {
      await Models[db].insertMany(data).catch((e) => {
        logger.error(
          `Operation failed while registering the seeder process for the '${this.name}' class.`,
          e,
          { suggestion: seederErrorMsg },
          'noSave',
        )
      })
    }),
  )

  ProgramModule.seeders.deleteSeeders()
}

/**
 * Extends the ZanixMongoConnector to execute seeders on models
 * injected through a DSL definition.
 *
 * This function is responsible for initializing and running seed scripts
 * associated with specific MongoDB models, allowing for streamlined data
 * population during development or setup.
 */
export async function runSeedersOnStart(this: ZanixMongoConnector) {
  const seeders = ProgramModule.seeders.getSeeders()

  if (!seeders.length) return

  await runAndSaveSeeders.call(this, seeders)
}

/**
 * Extends the ZanixMongoConnector to execute seeders on models
 * initialized by some schema.
 *
 * This function is responsible for initializing and running seed scripts
 * associated with specific MongoDB models, allowing for streamlined data
 * population during development or setup.
 */
export async function runSeedersBySchema(
  this: ZanixMongoConnector,
  seeders: SeederHandler[],
  modelName: string,
) {
  if (!seeders.length || Deno.env.get('DATABASE_SEEDERS') === 'false') return

  // Normalize seeders
  const adaptedSeeders: Seeders = [{
    model: modelName,
    handlers: seederAdaptation(seeders, { modelName }, 'mongo'),
  }]

  await runAndSaveSeeders.call(this, adaptedSeeders)
}
