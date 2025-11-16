import type { DecryptableObject, VerifiableObject } from 'typings/data.ts'
import type { SchemaAccessor } from 'database/typings/general.ts'
import type {
  DataProtection,
  DataProtectionBase,
  DataProtectionMethods,
  DataProtectionOptions,
} from 'typings/protection.ts'

import {
  createDecryptableObject,
  createHashFrom,
  createUnmaskableObject,
  createVerifiableObject,
  encrypt,
  extractVersion,
  mask,
} from 'utils/protection.ts'
import ProgramModule from 'modules/program/mod.ts'
import logger from '@zanix/logger'

/**
 * Normalize a data protection input into a full DataProtection object.
 *
 * @param protection - Can be a strategy name ('mask' | 'hash' | 'encrypt')
 *                     or a partial/full DataProtection object.
 */
export const normalizeDataProtection = (
  dataProtection: DataProtectionOptions,
): DataProtection => {
  const protection: DataProtectionBase<DataProtectionMethods> = (typeof dataProtection === 'string')
    ? { activeVersion: 'v0', versionConfigs: { 'v0': { strategy: dataProtection } } }
    : 'activeVersion' in dataProtection
    ? dataProtection
    : { activeVersion: 'v0', versionConfigs: { 'v0': dataProtection } }

  return protection as DataProtection
}

/**
 * Define the data protection for a data field, applying the given options and an optional value. (e.g. `decrypt`, `unmask`)
 *
 * @param { DataProtection['versionConfigs']} config - The access policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 *
 * @returns {VerifiableObject | DecryptableObject} The modified value or values after applying the data protection settings.
 *                            For `hashing` it provides the verifier function.
 */
export const dataProtectionGetterDefinition = (
  config: DataProtection,
  value?: string | string[],
): VerifiableObject | DecryptableObject => {
  if (!value) return
  const { message, version } = extractVersion(value)

  const variants = config.versionConfigs[version]

  if (!variants) return value

  const { settings, strategy } = variants

  switch (strategy) {
    case 'mask':
      return createUnmaskableObject(message, settings, version)
    case 'encrypt':
      return createDecryptableObject(message, settings, version)
    case 'hash':
      return createVerifiableObject(message, settings, version)
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
 * @param {DataProtectionConfigs & { version: `V${number}` }} configs - The protection policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 *
 * @returns {undefined|string|string[]|(input: string)=>Promise<boolean> } The modified value or values after applying the data protection settings.
 *                            For `hashing` it provides the verifier function.
 */
export const dataProtectionSetterDefinition = (
  configs: DataProtection,
  value?: string | string[],
  // deno-lint-ignore no-explicit-any
): any => {
  if (!value) return

  const version = configs.activeVersion // Always ensure that data policies are applied using the latest version.
  const { strategy, settings } = configs.versionConfigs[version]

  switch (strategy) {
    case 'mask':
      return mask(value, settings, version)
    case 'encrypt':
      return encrypt(value, settings, version)
    case 'hash':
      return createHashFrom(value, settings)
    default:
      return value
  }
}

/**
 * Creates a schema accessor that transparently applies data protection operations
 * (such as `decrypt` or `unmask`) when reading a protected field.
 *
 * This function wraps an existing getter with the appropriate data protection logic,
 * ensuring sensitive fields are automatically decrypted, unmasked, or otherwise processed
 * according to the provided protection settings.
 *
 * @param {DataProtectionOptions} protection - The data protection configuration for the field.
 *   Defines how the field’s value should be handled, including:
 *   - The protection strategy (`mask`, `hash`, `encrypt`, etc.)
 *   - The selected policy settings
 *   - The policy version (if applicable)
 *
 * @param {SchemaAccessor} [baseGetter=(v) => v] - The base getter function that retrieves the field value.
 *   This function receives the raw stored value and returns it (optionally transformed).
 *   Defaults to an identity function if not provided.
 *
 * @returns {SchemaAccessor} A new schema accessor that applies the specified data protection rules
 *   before returning the field value.
 *
 * ---
 * ### 🔐 Environment Variable Usage
 *
 * Depending on the selected protection strategy, the following environment variables are used:
 *
 * **Masking/unmasking (`mask`)**
 *   - Primary: `DATA_SECRET_KEY`
 *   - Fallback: `DATA_AES_KEY`
 *
 * **Symmetric encryption/decryption (`encrypt`->`symmetric`)**
 *   - Uses: `DATA_AES_KEY`
 *
 * **Asymmetric encryption/decryiption (`encrypt`->`asymmetric`)**
 *   - Uses (base64): `DATA_RSA_PUB`, `DATA_RSA_KEY`
 *
 * ---
 * ### 🌐 Environment Variable Naming by Version
 *
 * Define versioned environment variables as follows:
 * - **Symmetric encryption:** `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
 * - **Asymmetric encryption:** `DATA_RSA_PUB_V1`, `DATA_RSA_PUB_V2`, etc.
 *
 * If no version is provided (defaults to **v0**), which uses non-suffixed environment variables:
 * - For symmetric encryption → uses `DATA_AES_KEY`
 * - For asymmetric encryption → uses `DATA_RSA_PUB`, `DATA_RSA_KEY`
 * - For masking → uses `DATA_SECRET_KEY` or `DATA_AES_KEY`
 *
 * ---
 * ### ⚠️ Warnings
 *
 * - If no valid key is found for the configured method, **no encryption, decryption, masking, or unmasking is performed**.
 * - Ensure that the same keys and versions are available both at encryption/masking and decryption/unmasking time.
 *
 * ---
 * ### 🧩 Example
 *
 * ```ts
 * const maskGetter = dataProtectionGetter({ strategy: 'mask', settings: { endBefore: '@' } })
 * const asymmEncryptGetter = dataProtectionGetter({ strategy: 'encrypt', settings: { type: 'asymmetric' } })
 * const symmEncryptGetter = dataProtectionGetter('encrypt') // defaults applied
 * const hashGetter = dataProtectionGetter('hash') // defaults applied
 *
 * const unmaskableString: UnmaskableObject = maskGetter(maskedFieldValue)
 * const unmaskableValue = UnmaskableObject.unmask()
 *
 * const decryptedAsymString: DecryptableObject = asymmEncryptGetter(asymmEncryptedFieldValue)
 * const decryptedAsymValue = await decryptedAsymString.decrypt()
 *
 * const decryptedSymString: DecryptableObject = symmEncryptGetter(symmEncryptedFieldValue)
 * const decryptedSymValue = await decryptedSymString.decrypt()
 *
 * const verifiableString: VerifiableObject = hashGetter(hashedFieldValue)
 * await verifiableString.verify(passwordToVerify)
 * ```
 *
 * ---
 * ### 🧩 Example of a Versioned Configuration
 *
 * ```ts
 * dataProtectionGetter({
 *    activeVersion: 'v1',
 *    versionConfigs: {
 *      v0: {
 *         strategy: 'mask',
 *         settings: { endBefore: 3 },
 *       },
 *      v1: {
 *        strategy: 'mask',
 *        settings: { endBefore: 1 },
 *      },
 *    },
 *   })
 * ```
 *
 * The first (default) version is **v0**, which uses **non-suffixed environment variables**.
 * When introducing a new version, ensure that **the previous version remains available**
 * until the migration or rotation process has been fully executed.
 *
 * You can automate this rotation process using the utility **`seedRotateProtectionKeys`**.
 *
 * @getter
 */
export function dataProtectionGetter(
  this: void,
  protection: DataProtectionOptions,
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor {
  if (typeof this === 'object') {
    logger.warn(
      'A Data protection getter definition (dataProtectionGetter) is incorrectly implemented and needs to be reviewed.',
      'noSave',
    )

    return protection as unknown as SchemaAccessor
  }

  const dataProtection = normalizeDataProtection(protection)

  const accessor: SchemaAccessor = (value, options) => {
    const processedValue = dataProtectionGetterDefinition(dataProtection, value)

    return baseGetter(processedValue, options)
  }

  ProgramModule.accessors.setDataProtection(accessor, dataProtection)

  return accessor
}
