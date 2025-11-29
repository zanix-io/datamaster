import type { SchemaAccessor } from 'database/typings/general.ts'
import type { DataAccessConfig, DataFieldAccess } from 'typings/protection.ts'

import { ProgramModule, type Session } from '@zanix/server'
import Program from 'modules/program/mod.ts'
import { mask } from '@zanix/helpers'
import logger from '@zanix/logger'

/**
 * Define the access policy for a data field, applying the given options and an optional value.
 *
 * @param {DataAccessConfig} options - The access policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 * @param {Session} [session] - The optional session context. If not provided it use ALS.
 *
 * @returns {undefined|string|string[]} The modified value or values after applying the access policy.
 *                            If no value is provided, the function may return `undefined`.
 */
export function dataAccessGetterDefinition(
  options: DataAccessConfig,
  value?: string | string[],
  session?: Session,
): undefined | string | string[] {
  if (!value) return

  const { strategy: accessType, settings } = options
  session = session || ProgramModule.asyncContext.getStore()?.session

  const isAnonymous = session?.type === 'anonymous'

  const shouldRemove = accessType === 'internal' || !session ||
    (accessType === 'private' && isAnonymous)

  if (shouldRemove) {
    if (!session) {
      logger.warn('Data access policies are enabled, but no session was found.', {
        code: 'DATA_ACCESS_NO_SESSION',
        meta: {
          suggestion:
            "Set 'userSession' in the toJSON transform options, or enable ALS through the model configuration options if a manual session is not used.",
          policyEnabled: true,
          source: 'zanix',
        },
      })
    }
    return
  }

  if (isAnonymous && accessType === 'protected') {
    value = mask(value, '*', { ...settings?.virtualMask, algorithm: 'hard' })
  }

  return value
}

/**
 * Set the access policy for a given data field (string or string array), applying the specified base getter function.
 *
 * ⚠️ This function requires context to work correctly.
 * You can achieve this either by activating AsyncLocalStorage (ALS) in the controller or handler and configuring the connector with useALS: true,
 * or by including the user session (userSession property) when performing the toJSON transformation.
 *
 * @param {DataFieldAccess} access - The access policy for the data field. This defines the
 *                                  rules or permissions associated with the field.
 * @param {SchemaAccessor} [baseGetter=(v) => v] - The base getter function to modify the field value.
 *                                               It is a function that accepts a value and returns the modified value.
 *                                               Defaults to an identity function if not provided.
 *
 * @returns {SchemaAccessor} A new schema accessor function that incorporates the given access policy and base getter.
 *
 * ---
 * ### 🧩 Example
 *
 * ```ts
 * const privateFieldGetter = dataAccessGetter('private')
 *
 * const result = privateFieldGetter(fieldValue) // undefine or available if user is authenticated
 * ```
 *
 * @getter
 */
export function dataAccessGetter(
  this: void,
  access: DataFieldAccess,
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor {
  if (typeof this === 'object') {
    logger.warn(
      'An access policy getter definition (dataAccessGetter) is incorrectly implemented and needs to be reviewed.',
      'noSave',
    )

    return access as unknown as SchemaAccessor
  }

  const accessor: SchemaAccessor = (value, options) => {
    const processedValue = baseGetter(value, options)

    return dataAccessGetterDefinition(dataAccess, processedValue)
  }

  const dataAccess = (typeof access === 'string') ? { strategy: access } : access
  Program.accessors.setDataAccess(accessor, dataAccess)

  return accessor
}
