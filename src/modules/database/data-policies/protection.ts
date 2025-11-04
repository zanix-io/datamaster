import type { EncryptedString, HashedString } from 'typings/data.ts'
import type {
  DataProtectionMethod,
  DataProtectionMethodFull,
  SchemaAccessor,
} from 'database/typings/general.ts'

import {
  createDecryptObject,
  createHashFrom,
  createVerifyObject,
  encrypt,
  mask,
  unmask,
} from 'database/utils/protection.ts'
import ProgramModule from 'modules/program/mod.ts'
import logger from '@zanix/logger'

/**
 * Define the data protection for a data field, applying the given options and an optional value. (e.g. `decrypt`, `unmask`)
 *
 * @param {DataFieldAccess} options - The access policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 *
 * @returns {HashedString | EncryptedString} The modified value or values after applying the data protection settings.
 *                            For `hashing` it provides the verifier function.
 */
export const dataProtectionGetterDefinition = (
  options: DataProtectionMethod,
  value?: string | string[],
): HashedString | EncryptedString => {
  if (!value) return

  const { type: dataMethod } = options

  switch (dataMethod) {
    case 'masking':
      return unmask(value)
    case 'sym-encrypt':
    case 'asym-encrypt':
      return createDecryptObject(value, dataMethod)
    case 'hashing':
      return createVerifyObject(value)
    default:
      return value
  }
}

/**
 * Define the data protection for a data field, applying the given options and an optional value. (e.g. `encrypt`, `mask`)
 *
 * ⚠️ WARNING:
 * This setter should not be used directly as a field setter; it is intended for use in hooks only.
 *
 * @param {DataFieldAccess} options - The access policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 *
 * @returns {undefined|string|string[]|(input: string)=>Promise<boolean> } The modified value or values after applying the data protection settings.
 *                            For `hashing` it provides the verifier function.
 */
export const dataProtectionSetterDefinition = (
  options: DataProtectionMethod,
  value?: string | string[],
  // deno-lint-ignore no-explicit-any
): any => {
  if (!value) return

  const { type: dataMethod } = options

  switch (dataMethod) {
    case 'masking':
      return mask(value)
    case 'sym-encrypt':
    case 'asym-encrypt':
      return encrypt(value, dataMethod)
    case 'hashing':
      return createHashFrom(value, 'medium')
    default:
      return value
  }
}

/**
 * @getter
 *
 * Applies the data protection settings for a given data field (string or string array), (e.g. `decrypt`, `unmask`) behind a getter.
 *
 * @param {DataProtectionMethodFull} protection - The data protection settings for the data field. This defines the
 *                                  rules associated with the field.
 * @param {SchemaAccessor} [baseGetter=(v) => v] - The base getter function to return the field value.
 *                                               It is a function that accepts a value and returns the modified value.
 *                                               Defaults to an identity function if not provided.
 *
 * @returns {SchemaAccessor} A new schema accessor function that incorporates the given data protection and base getter.
 *
 * ℹ️ For the 'masking' method, it first checks for the environment variable `DATABASE_SECRET_KEY`.
 * If not found, it falls back to `DATABASE_AES_KEY`.
 *
 * ℹ️ For the 'sym-encrypt' method, it uses `DATABASE_AES_KEY`.
 *
 * ℹ️ For the 'asym-encrypt' method, it first checks for the environment `base64` variables `DATABASE_RSA_PUB` and `DATABASE_RSA_KEY`.
 * If not found, it falls back to `DATABASE_AES_KEY` and applies 'sym-encrypt' method.
 *
 * ⚠️ If no key is found for any method, no encryption/hashing/masking or decryption/unmasking is performed.
 */
export function dataProtectionGetter(
  this: void,
  protection: DataProtectionMethodFull,
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor {
  if (typeof this === 'object') {
    logger.warn(
      'A Data protection getter definition (dataProtectionGetter) is incorrectly implemented and needs to be reviewed.',
    )

    return protection as unknown as SchemaAccessor
  }

  const dataProtection = (typeof protection === 'string') ? { type: protection } : protection

  const accessor: SchemaAccessor = (value, options) => {
    const processedValue = dataProtectionGetterDefinition(dataProtection, value)

    return baseGetter(processedValue, options)
  }

  ProgramModule.accessors.setAccessorDataProtection(accessor, dataProtection)

  return accessor
}
