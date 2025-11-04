import type { DataProtectionMethod } from 'database/typings/general.ts'
import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import { dataProtectionPreSave } from './save.ts'

/**
 * Registers Mongoose hooks or middleware that are triggered when a model is created.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema to which the hooks will be attached.
 * @param {Record<string, DataProtectionMethod>} dataProtection - An object mapping field names
 * to their corresponding data protection methods.
 */
export const hooks = (
  schema: BaseCustomSchema,
  dataProtection: Record<string, DataProtectionMethod>,
) => {
  dataProtectionPreSave(schema, dataProtection)
}
