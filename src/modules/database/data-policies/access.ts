import type {
  DataFieldAccess,
  DataFieldAccessFull,
  SchemaAccessor,
} from 'database/typings/general.ts'

import { ProgramModule, type Session } from '@zanix/server'
import { mask } from '@zanix/helpers'
import logger from '@zanix/logger'

/**
 * Define the access policy for a data field, applying the given options and an optional value.
 *
 * @param {DataFieldAccess} options - The access policy definition for the data field. This object defines
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
  options: DataFieldAccess,
  value?: string | string[],
  session?: Session,
): undefined | string | string[] {
  if (!value) return

  const { type: accessType } = options
  session = session || ProgramModule.asyncContext.getStore()?.session

  const isAnonymous = session?.type === 'anonymous'

  const shouldRemove = accessType === 'internal' || !session ||
    (accessType === 'private' && isAnonymous)

  if (shouldRemove) {
    if (!session) {
      logger.warn(
        "Data access policies are enabled, but no session was found. Set 'userSession' in the toJSON transform options, or enable ALS through the 'model configuration options' if a manual session is not used.",
      )
    }
    return
  }

  if (isAnonymous && accessType === 'protected') {
    value = mask(value, '*', { ...options.virtualMask, algorithm: 'hard' })
  }

  return value
}

/**
 * Set the access policy for a given data field (string or string array), applying the specified base getter function.
 *
 * ⚠️ This function requires that **AsyncLocalStorage (ALS)** is activated in the controller or handler
 * in order to function correctly with the appropriate context.
 * Make sure to configure the connector with the `useALS` option set to `true`.
 *
 * @param {DataFieldAccessFull} access - The access policy for the data field. This defines the
 *                                  rules or permissions associated with the field.
 * @param {SchemaAccessor} [baseGetter=(v) => v] - The base getter function to modify the field value.
 *                                               It is a function that accepts a value and returns the modified value.
 *                                               Defaults to an identity function if not provided.
 *
 * @returns {SchemaAccessor} A new schema accessor function that incorporates the given access policy and base getter.
 *
 * @getter
 */
export function dataAccessGetter(
  this: void,
  access: DataFieldAccessFull,
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor {
  if (typeof this === 'object') {
    logger.warn(
      'An access policy getter definition (dataAccessGetter) is incorrectly implemented and needs to be reviewed.',
    )

    return access as unknown as SchemaAccessor
  }

  const dataAccess = (typeof access === 'string') ? { type: access } : access

  return (value, options) => {
    const processedValue = baseGetter(value, options)

    return dataAccessGetterDefinition(dataAccess, processedValue)
  }
}
