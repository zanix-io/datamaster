import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import { dataProtectionPreSave } from './data-protection.ts'

/**
 * Registers Mongoose hooks or middleware that are triggered when a model is created.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema to which the hooks will be attached.
 *
 * to their corresponding data protection methods.
 */
export const hooks = (schema: BaseCustomSchema) => {
  dataProtectionPreSave(schema)
}
