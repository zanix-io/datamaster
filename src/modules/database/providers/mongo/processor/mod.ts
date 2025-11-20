import type { Extensions } from 'database/typings/general.ts'
import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { Model } from 'mongo/typings/commons.ts'
import type { DataAccessConfig, DataProtection } from 'typings/protection.ts'

import { baseTransformations } from './schema/transforms/mod.ts'
import { findPathsWithAccessorsDeep } from '../utils/accessors.ts'
import { processInternalAccessors } from 'mongo/utils/accessors.ts'
import { mainVirtuals } from './schema/virtuals.ts'
import { sanitizeModel } from './model/sanitize.ts'
import { statics } from './schema/statics/mod.ts'
import { methods } from './schema/methods/mod.ts'
import { hooks } from './middlewares/mod.ts'
import ProgramModule from 'modules/program/mod.ts'

/**
 * Process a database model before use.
 *
 * This function expects a model factory (a function that returns a Mongoose model or similar)
 * and applies processing steps such as sanitization, credential removal, or other setup logic
 * before returning the final, ready-to-use model.
 *
 * It is commonly used to ensure that sensitive data (e.g., connection strings)
 * are removed before exposing the model outside secure contexts.
 *
 * ⚠️ **Security Notice:**
 * - Do not expose unsanitized models in logs or API responses.
 * - If `sanitizeModel` mutates the model, this function will return the mutated version.
 *
 * @template T
 * @param { T} Model - A factory function that creates and returns a model instance.
 *
 * @returns {T} The sanitized and preprocessed model ready for use.
 */
export const postBindModel = <T extends Model>(Model: T): T => {
  sanitizeModel(Model)

  return Model
}

/**
 * Applies preprocessing steps to a Mongoose schema before model creation.
 *
 * This function is intended to standardize schema configuration by attaching
 * common virtuals, hooks, or other shared logic via helper utilities such as
 * {@link mainVirtuals} and {@link statics}. It ensures that all schemas maintain consistent behavior
 * across the application before they are compiled into models.
 *
 * ⚙️ **Behavior:**
 * - Modifies the provided `schema` in place by applying one or more transformations.
 * - Returns the same schema instance for chaining or model compilation.
 *
 * ⚠️ **Notes:**
 * - This function mutates the original schema (it does not clone it).
 * - Use it before calling `mongoose.model()` or equivalent.
 * - Avoid applying it multiple times to the same schema to prevent duplicate virtuals.
 *
 * @template T
 * @param {T} schema - A Mongoose `Schema` instance to preprocess.
 * @param {Omit<Extensions, 'seeders'>} extensions - Schema extensions options.
 * @returns {T} The same schema instance after preprocessing.
 */
export const preprocessSchema = <T extends BaseCustomSchema>(
  schema: T,
  extensions: Omit<Extensions, 'seeders'> = {},
): T => {
  // Data protection process
  const accessorsInfo = findPathsWithAccessorsDeep(schema)

  const dataProtection: Record<string, DataProtection> = {}
  const dataAccess: Record<string, DataAccessConfig> = {}

  // Associate an accessor function with its corresponding path
  processInternalAccessors(accessorsInfo.getterEntries, ({ path, function: fn }) => {
    const dataAccessInfo = ProgramModule.accessors.consumeDataAccess(fn)
    const dataProtectionInfo = ProgramModule.accessors.consumeDataProtection(fn)
    if (dataProtectionInfo) dataProtection[path] = dataProtectionInfo
    if (dataAccessInfo) dataAccess[path] = dataAccessInfo
  })

  // virtuals
  mainVirtuals(schema)

  // statics
  statics(schema, { dataAccess, dataProtection })

  // methods
  methods(schema)

  // base transformations accessors
  // `toObject` and `toJSON`
  baseTransformations(schema)

  // triggers
  extensions.triggers

  // hooks
  hooks(schema)

  // return adapted schema
  return schema
}
