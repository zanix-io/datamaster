import type { SchemaAccessor } from 'database/typings/general.ts'
import type { DataFieldAccess, DataProtectionOptions } from 'typings/protection.ts'

import { dataProtectionGetterDefinition, normalizeDataProtection } from './protection.ts'
import ProgramModule from 'modules/program/mod.ts'
import { ProgramModule as Program } from '@zanix/server'
import { dataAccessGetterDefinition } from './access.ts'

/**
 * Defines the data protection and access control behavior for a specific data field
 * (either a single string field or an array of strings).
 *
 * This getter wraps the schema field with data protection logic based on the configured
 * access and protection policies.
 *
 * See `dataAccessGetter` and `dataProtectionGetter` for specific information.
 *
 * ℹ️ Note: In this case, `dataProtectionGetter` is used directly as the field getter.
 * The data access options are intended to be used (either automatically or manually) during
 * the `toJSON` / `toObject` transformations.
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
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor => {
  const { access, protection } = options

  const dataAccess = (typeof access === 'string') ? { strategy: access } : access
  const dataProtection = normalizeDataProtection(protection)

  const accessor: SchemaAccessor = (value, options) => {
    // If `useDataAccessGet` is defined, it returns the `dataAccessGetter` function.
    // This is defined and used by the **access transformer** (e.g., during the `toJSON` transformation)
    // to retrieve the data from the appropriate source.
    // Once consumed, `useDataAccessGet` returns to its original state,
    // ensuring that the data access behavior is reset for future use.
    if (Program.asyncContext.getStore()?.useDataAccessGet) {
      const processedValue = baseGetter(value, options)
      return dataAccessGetterDefinition(dataAccess, processedValue)
    }

    const processedValue = dataProtectionGetterDefinition(dataProtection, value)
    return baseGetter(processedValue, options)
  }

  ProgramModule.accessors.setDataAccess(accessor, dataAccess)
  ProgramModule.accessors.setDataProtection(accessor, dataProtection)

  return accessor
}
