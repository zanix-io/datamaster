import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { Triggers } from 'database/typings/triggers.ts'
import { dataProtectionPreSave } from './data-protection.ts'
import { triggersMiddleware } from '../triggers/mod.ts'

/**
 * Registers Mongoose hooks or middleware that are triggered when a model is created.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema to which the hooks will be attached.
 * @param {string} modelName - The model's name, used to key the per-model trigger registry.
 * @param {string} connectorKey - The connector this model is bound to — see
 * {@link triggersMiddleware} for why this is threaded through.
 * @param {Triggers} [triggers] - The model's static trigger configuration, wired up via
 * {@link triggersMiddleware}.
 * @param {boolean} [autoProtectOnUpdate] - The model's `extensions.autoProtectOnUpdate`, wired up
 * via {@link dataProtectionPreSave}.
 *
 * to their corresponding data protection methods.
 */
export const hooks = (
  schema: BaseCustomSchema,
  modelName: string,
  connectorKey: string,
  triggers?: Triggers,
  autoProtectOnUpdate?: boolean,
) => {
  dataProtectionPreSave(schema, autoProtectOnUpdate)
  triggersMiddleware(schema, modelName, connectorKey, triggers)
}
