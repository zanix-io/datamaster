import type { SeederHandler } from 'database/typings/general.ts'
import type { ZanixMongoConnector } from './mod.ts'
import type { Seeders } from '@zanix/server'

import { seederAdaptation } from 'database/utils/seeders/adaptation.ts'
import { DATABASE_SEEDERS_ENV } from 'database/utils/constants.ts'
import ProgramModule from 'modules/program/mod.ts'
import { defineSeedModelOnce } from './models.ts'
import logger from '@zanix/logger'
import { InternalError } from '@zanix/errors'

const seederErrorMsg =
  `Verify configuration settings and ensure there are no duplicated seeder names.`

/**
 * Function to run and save seeders
 */
async function runAndSaveSeeders(this: ZanixMongoConnector, seeders: Seeders) {
  const Models = await defineSeedModelOnce.call(this) // execute before run seeders to prepare existInDB

  await this.runSeeders(seeders)

  if (!Models) {
    return ProgramModule.seeders.deleteSeeders(
      'mongo',
      this.resolvedConnectorKey,
    )
  }

  const dataToSave = ProgramModule.seeders.consumeDataToQuery(
    'save',
    'mongo',
    this.resolvedConnectorKey,
  )
  await Promise.all(
    Object.entries(dataToSave).map(async ([db, data]) => {
      const Model = Models[db]

      if (!Model) {
        logger.error(
          `Operation failed while registering the seeder process for the '${this.name}' class.`,
          new InternalError(
            `No seed-tracking model bound for database "${db}" — the seeder data collected for ` +
              `it can't be saved.`,
            {
              code: 'MONGO_SEEDER_MODEL_NOT_BOUND',
              meta: {
                source: 'zanix',
                connectorName: this.name,
                connectorKey: this.resolvedConnectorKey,
                database: db,
              },
            },
          ),
          { suggestion: seederErrorMsg },
          'noSave',
        )
        return
      }

      await Model.insertMany(data).catch((e) => {
        logger.error(
          `Operation failed while registering the seeder process for the '${this.name}' class.`,
          e,
          { suggestion: seederErrorMsg },
          'noSave',
        )
      })
    }),
  )

  ProgramModule.seeders.deleteSeeders('mongo', this.resolvedConnectorKey)
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
  const seeders = ProgramModule.seeders.getSeeders(
    'mongo',
    this.resolvedConnectorKey,
  )

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
  if (!seeders.length || Deno.env.get(DATABASE_SEEDERS_ENV) === 'false') return

  // Normalize seeders
  const adaptedSeeders: Seeders = [{
    model: modelName,
    handlers: seederAdaptation(
      seeders,
      { modelName },
      'mongo',
      this.resolvedConnectorKey,
    ),
  }]

  await runAndSaveSeeders.call(this, adaptedSeeders)
}
