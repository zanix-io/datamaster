import type { AdaptedModelBySchema } from '../typings/models.ts'
import type { SchemaModelInitOptions } from '../typings/schema.ts'
import type { DefaultSchema } from '../typings/commons.ts'
import type { ZanixMongoConnector } from './mod.ts'

import ProgramModule from 'modules/program/public.ts'
import { postBindModel } from '../processor/mod.ts'
import { runSeedersBySchema } from './seeders.ts'
import { Schema } from 'mongoose'

/**
 * Extends the ZanixMongoConnector to define and register
 * all models injected through a Higher-Order Component (HOC).
 *
 * It retrieves model definitions and optional callbacks from metadata,
 * creates schemas, optionally processes them with callbacks,
 * and binds each model to the database.
 * Finally, it clears the 'models' metadata to avoid redefinition.
 */
export function defineModels(this: ZanixMongoConnector) {
  const { models } = ProgramModule.getMetadata()

  for (const model of models) {
    const schema = new Schema(model.definition, model.options)
    const finalSchema = model.callback ? model.callback(schema) as typeof schema : schema

    this['bindModel'](model.name, finalSchema, model.extensions)
  }
  ProgramModule.deleteMetadata('models')
}

/**
 * Extends the ZanixMongoConnector to define and register
 * a model initialized by some schema.
 */
export async function defineModelBySchema<S extends DefaultSchema>(
  this: ZanixMongoConnector,
  options: SchemaModelInitOptions<S>,
  entity: S,
) {
  const { extensions: { seeders = [], ...extensions } = {}, relatedModels = {} } = options

  // Bind related models first
  for (const [relatedName, relatedSchema] of Object.entries(relatedModels)) {
    this.getModel(relatedName, relatedSchema.schema, relatedSchema.options)
  }

  // Bind the main model
  const Model = this['bindModel'](name, entity, extensions)

  // Run seeders
  await runSeedersBySchema.call(this, seeders)

  return postBindModel(Model) as AdaptedModelBySchema<S>
}
