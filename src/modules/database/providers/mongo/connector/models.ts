import type { AdaptedModel, AdaptedModelBySchema } from '../typings/models.ts'
import type { SchemaModelInitOptions } from '../typings/schema.ts'
import type { DefaultSchema } from '../typings/commons.ts'
import type { ZanixMongoConnector } from './mod.ts'

import { registerSeedModel } from '../defs/seeders.ts'
import ProgramModule from 'modules/program/mod.ts'
import { postBindModel } from '../processor/mod.ts'
import { runSeedersBySchema } from './seeders.ts'
import { Schema } from 'mongoose'

/**
 * Extends the ZanixMongoConnector to define and register
 * all models injected through a DSL definition.
 *
 * It retrieves model definitions and optional callbacks from metadata,
 * creates schemas, optionally processes them with callbacks,
 * and binds each model to the database.
 * Finally, it clears the 'models' metadata to avoid redefinition.
 */
export function defineModels(this: ZanixMongoConnector) {
  const models = ProgramModule.models.getModels()

  for (const model of models) {
    const schema = new Schema(model.definition, model.options)
    const finalSchema = model.callback ? model.callback(schema) as typeof schema : schema

    this.bindModel(model.name, finalSchema, model.extensions)
  }

  ProgramModule.models.deleteModels()
}

/**
 * Extends the ZanixMongoConnector to define and register
 * a model initialized by some schema.
 */
export function defineModelBySchema<S extends DefaultSchema>(
  this: ZanixMongoConnector,
  options: SchemaModelInitOptions<S>,
  modelName: string,
  entity: S,
) {
  const {
    callback = () => {},
    extensions: { seeders = [], ...extensions } = {},
    relatedModels = {},
  } = options

  // Bind related models first
  for (const [relatedName, relatedSchema] of Object.entries(relatedModels)) {
    this.getModel(relatedName, relatedSchema.schema, relatedSchema.options)
  }

  // Bind the main model
  const Model = this.bindModel(modelName, entity, extensions)

  const AdaptedModel = postBindModel(Model) as AdaptedModelBySchema<S>

  // Run seeders
  runSeedersBySchema.call(this, seeders, modelName)
    .then(() => callback(AdaptedModel, 'seeders executed'))
    .catch((e) => callback(AdaptedModel, e.message || 'an error ocurred running seeders'))

  return AdaptedModel
}

/** Load Seed Core Models */
export async function defineSeedModelOnce(this: ZanixMongoConnector) {
  if (!this.seederModel) return

  const dataToFind = ProgramModule.seeders.consumeDataToQuery('find')
  const dataKeys = Object.keys(dataToFind)

  const Models: Record<string, AdaptedModel> = {}
  const modelBaseName = this.seederModel

  const seedModelName = (db: string) => db === 'default' ? modelBaseName : `${db}:${modelBaseName}`

  for await (const db of dataKeys) {
    const seedModel = seedModelName(db)
    registerSeedModel(seedModel)
  }

  defineModels.call(this)

  await Promise.all(
    Object.entries(dataToFind).map(async ([db, data]) => {
      Models[db] = this.getModel(seedModelName(db))

      const seeders = await Models[db].find({ $or: data as never }, { name: 1, version: 1 }).lean()

      for (const doc of seeders) ProgramModule.seeders.existInDB.add(doc.name + '@' + doc.version)
    }),
  )

  this.seederModel = false

  return Models
}
