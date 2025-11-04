import type { SchemaModelExtensions } from '../typings/schema.ts'
import type { ZanixMongoConnector } from './mod.ts'
import type { Seeders } from '@zanix/server'

import ProgramModule from 'modules/program/public.ts'
import logger from '@zanix/logger'

/**
 * Extends the ZanixMongoConnector to execute seeders on models
 * injected through a Higher-Order Component (HOC).
 *
 * This function is responsible for initializing and running seed scripts
 * associated with specific MongoDB models, allowing for streamlined data
 * population during development or setup.
 */
export async function runSeedersOnStart(this: ZanixMongoConnector) {
  const { seeders } = ProgramModule.getMetadata()

  await this.runSeeders(seeders)

  ProgramModule.deleteMetadata('seeders')

  logger.success(`MongoDB Connected Successfully in '${this.name}' class`)
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
  seeders: Required<SchemaModelExtensions>['seeders'],
) {
  // Normalize seeders
  const [firstSeeder] = seeders
  const adaptedSeeder: Seeders = typeof firstSeeder === 'function'
    ? [{ model: name, handlers: seeders as Seeders[0]['handlers'] }]
    : (seeders as Seeders)

  await this.runSeeders(adaptedSeeder)
}
