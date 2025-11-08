import type { SchemaAccessor } from 'database/typings/general.ts'
import type { DataFieldAccess, DataProtectionOptions } from 'database/typings/protection.ts'

import { dataProtectionGetter, normalizeDataProtection } from './protection.ts'
import ProgramModule from 'modules/program/mod.ts'
import { ProgramModule as Program } from '@zanix/server'
import { dataAccessGetter } from './access.ts'

/**
 * Defines the data protection and access control behavior for a specific data field
 * (either a single string field or an array of strings).
 *
 * This getter wraps the schema field with data protection logic based on the configured
 * access and protection policies.
 *
 * @see {@link dataAccessGetter} and {@link dataProtectionGetter} for specific information.
 *
 * ℹ️ Note: In this case, only `dataProtectionGetter` is used directly as a field getter.
 * The data field access options are intended to be used for `toJSON` / `toObject` transforms.
 * Therefore, the use of `AsyncLocalStorage` is not required in this context,
 * unless the connector is explicitly configured with the `useALS` option set to `true`.
 *
 * @param {Object} options - Configuration for data access and protection.
 * @param {DataFieldAccess} options.access - The access control policy for the field.
 * @param {DataProtectionOptions} options.protection - The data protection policy to apply.
 * @param {SchemaAccessor} [baseGetter] - Optional base getter to wrap or extend.
 * @returns {SchemaAccessor} The configured schema accessor with data protection behavior.
 *
 * ---
 * ### 🧩 Example
 *
 * ```ts
 * const policyGetter = dataPoliciesGetter({
 *      // Masks the value when accessed or returned to the user.
 *      // Example: 'user@example.com' → '******@example.com'.
 *      access: { strategy: 'protected', settings: { endBefore: '@' } },
 *      // Masks the value before saving it to the database, ensuring sensitive data is stored securely.
 *      protection: { strategy: 'mask' },
 *    })
 * ```
 * @getter
 */
export const dataPoliciesGetter = (
  options: {
    access: DataFieldAccess
    protection: DataProtectionOptions
  },
  baseGetter?: SchemaAccessor,
): SchemaAccessor => {
  const { access, protection } = options

  const accessor: SchemaAccessor = (value, options) => {
    //  If `useDataAccessGet` is defined, it returns `dataAccessGetter`.
    if (Program.asyncContext.getStore()?.useDataAccessGet) {
      return dataAccessGetter(access)(value, options)
    }

    return dataProtectionGetter(protection, baseGetter)(value, options)
  }

  const dataAccess = (typeof access === 'string') ? { strategy: access } : access
  ProgramModule.accessors.setDataAccess(accessor, dataAccess)

  const dataProtection = normalizeDataProtection(protection)
  ProgramModule.accessors.setDataProtection(accessor, dataProtection)

  return accessor
}
