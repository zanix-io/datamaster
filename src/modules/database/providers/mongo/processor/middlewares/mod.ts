import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { Triggers } from 'database/typings/triggers.ts'
import { dataProtectionPreSave } from './data-protection.ts'
import { triggersMiddleware } from '../triggers/mod.ts'

/**
 * Registers Mongoose hooks or middleware that are triggered when a model is created.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema to which the hooks will be attached.
 * @param {string} modelName - The model's name, used to key the per-model trigger registry.
 * @param {Triggers} [triggers] - The model's static trigger configuration, wired up via
 * {@link triggersMiddleware}.
 *
 * to their corresponding data protection methods.
 */
export const hooks = (schema: BaseCustomSchema, modelName: string, triggers?: Triggers) => {
  dataProtectionPreSave(schema)
  triggersMiddleware(schema, modelName, triggers)
}
