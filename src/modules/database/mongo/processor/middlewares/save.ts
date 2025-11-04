import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { DataProtectionMethod } from 'database/typings/general.ts'

import { dataProtectionSetterDefinition } from 'database/data-policies/protection.ts'
import { transformShallowByPaths } from '../schema/transforms/shallow.ts'

/**
 * Registers a Mongoose pre-save hook that enforces data protection rules.
 *
 * This function inspects the schema’s metadata to find the configured
 * data protection getters. For each protected path, it applies the corresponding
 * transform and executes the data protection getter before the document is saved.
 *
 * In short, it runs all data protection transformations defined in the schema
 * to ensure that sensitive fields are encrypted, masked or sanitized before persistence.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema where the data protection pre-save hook will be applied.
 * @param {Record<string, DataProtectionMethod>} dataProtection - Metadata describing the data protection getters and the paths they apply to.
 * @returns {void} Registers the pre-save hook on the schema (no direct return value).
 */
export const dataProtectionPreSave = (
  schema: BaseCustomSchema,
  dataProtection: Record<string, DataProtectionMethod>,
): void => {
  const allowedPaths = Object.keys(dataProtection)

  if (!allowedPaths.length) return

  schema.pre('save', async function (next) {
    if (!this.isNew) return

    await transformShallowByPaths(this, {
      allowedPaths: allowedPaths,
      transform: (value, path) => {
        return dataProtectionSetterDefinition(dataProtection[path], value)
      },
    })

    next()
  })
}
