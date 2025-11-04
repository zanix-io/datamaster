import type { ModelHOC } from 'database/typings/models.ts'
import type { SeederHandler } from '../typings/general.ts'

import ProgramModule from 'modules/program/mod.ts'

/**
 * A higher-order component (HOC) that adds a model to the `ProgramModule`'s model registry.
 * This function enhances the given model by adding it to a collection or registry of models,
 * optionally specifying the database type (defaulting to `'mongo'`).
 *
 * @function
 * @param model - The model to be added to the model registry.
 * @param type - An optional database type that the model is associated with. Defaults to `'mongo'`.
 *
 * @example
 * // Example usage of defineModelHOC
 * const MyModel = {...} as const;
 * defineModelHOC<Attrs>(MyModel);
 *
 * @example
 * // Example usage with MyModel specification
 * defineModelHOC({
 *   name: 'test',
 *   definition: {
 *     name: {
 *       type: String,
 *       unique: true,
 *       access: { type: 'internal' },
 *       protection: { type: 'asym-encrypt' },
 *     },
 *     description: {
 *       access: 'private',
 *       type: String,
 *     },
 *     createdAt: { type: Date, default: Date.now },
 *     updatedAt: { type: Date, default: Date.now },
 *   },
 *   options: {...},
 *   callback: (schema) => {
 *     // Additional schema customizations or logic
 *     return schema;
 *   },
 * });
 */
export const defineModelHOC: ModelHOC = ({ extensions = {}, ...model }, type) => {
  if (!type) type = 'mongo' as never

  const { seeders = [], ...exts } = extensions

  ProgramModule.models.addModel({ ...model, extensions: exts }, type)
  ProgramModule.seeders.addSeeder({
    model: type === 'mongo' ? model.name : model,
    handlers: seeders as SeederHandler[],
  })
}
