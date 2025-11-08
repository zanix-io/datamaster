import type { SeederHandler } from 'database/typings/general.ts'
import type { ZanixMongoConnector } from './mod.ts'
import type { Seeders } from '@zanix/server'

import ProgramModule from 'modules/program/mod.ts'
import { defineSeedModelOnce } from './models.ts'
import { seederAdaptation } from '../../../utils/seeders/adaptation.ts'
import logger from '@zanix/logger'

const seederErrorMsg =
  `Verify configuration settings and ensure there are no duplicated seeder names.`

/**
 * Extends the ZanixMongoConnector to execute seeders on models
 * injected through a Higher-Order Component (HOC).
 *
 * This function is responsible for initializing and running seed scripts
 * associated with specific MongoDB models, allowing for streamlined data
 * population during development or setup.
 */
export async function runSeedersOnStart(this: ZanixMongoConnector) {
  const seeders = ProgramModule.seeders.getSeeders()

  if (!seeders.length) return

  const Model = await defineSeedModelOnce.call(this)
  await this.runSeeders(seeders)

  await Model?.insertMany(ProgramModule.seeders.consumeDataToQuery('save')).catch((e) => {
    logger.error(
      `Operation failed while registering the seeder process for the '${this.name}' class.`,
      {
        message: seederErrorMsg,
        cause: e,
      },
    )
  })

  ProgramModule.seeders.deleteSeeders()
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
  if (!seeders.length) return

  // Normalize seeders
  const adaptedSeeders: Seeders = [{
    model: modelName,
    handlers: seederAdaptation(seeders, { modelName }, 'mongo'),
  }]

  const Model = await defineSeedModelOnce.call(this)

  await this.runSeeders(adaptedSeeders)

  await Model?.insertMany(ProgramModule.seeders.consumeDataToQuery('save')).catch((e) => {
    logger.error(
      `Operation failed while registering the seeder process for the '${this.name}' class.`,
      {
        message: seederErrorMsg,
        cause: e,
      },
    )
  })
}
