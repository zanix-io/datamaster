import type { DecryptableObject, UnmaskableObject, VerifiableObject } from 'typings/data.ts'
import type {
  DataPolicyVersion,
  EncryptSettings,
  HashingLevels,
  HashingSettings,
  MaskingSettings,
} from 'typings/protection.ts'

import { generateHash, validateHash } from '@zanix/helpers'
import logger from '@zanix/logger'
import {
  decrypt as baseDecrypt,
  encrypt as baseEncrypt,
  mask as baseMask,
  unmask as baseUnmask,
} from '@zanix/helpers'

const VERSION_SUFFIX = ':'

/** Get normalized secret version */
const normalizeSecretVersion = (version?: string) => {
  return version && version !== 'v0' ? `_${version.toUpperCase()}` : ''
}

/** Get mask secret */
const getMaskSecret = (v?: string) => {
  const version = normalizeSecretVersion(v)
  const baseKey = `DATA_SECRET_KEY${version}`
  const key = Deno.env.get(baseKey) || Deno.env.get(`DATA_AES_KEY${version}`)

  if (key) return key

  const error =
    `Masking key missing: please define '${baseKey}' or 'DATA_AES_KEY${version}' in your environment.`

  throw new Error(error)
}

/** Get encrypt secret */
const getEncryptSecret = (
  action: 'encrypt' | 'decrypt',
  type?: 'asymmetric' | 'symmetric',
  v?: string,
) => {
  const key: { name?: string; value?: string } = {}
  const version = normalizeSecretVersion(v)

  if (type === 'asymmetric') {
    key.name = action === 'encrypt' ? `DATA_RSA_PUB${version}` : `DATA_RSA_KEY${version}`
    const rsaKey = Deno.env.get(key.name)
    key.value = rsaKey && atob(rsaKey)
  } else {
    key.name = `DATA_AES_KEY${version}`
    key.value = Deno.env.get(key.name)
  }

  if (key.value) return key.value

  const error = `Encryption key missing: define a valid '${key.name}' in your environment.`

  throw new Error(error)
}

/** Function to validate a hash */
const verifyFn = (hash: string, level: HashingLevels = 'medium') => (input: string) =>
  validateHash(input, hash, level)

/** Function to append a version in encrypted/masked message */
const appendVersion = (message: string | string[], version?: string): string | string[] => {
  const suffix = version ? `${version}${VERSION_SUFFIX}` : ''
  if (Array.isArray(message)) {
    // Only add the version to the first element
    message[0] = `${suffix}${message[0]}`

    return message
  }
  return `${suffix}${message}`
}

/** Function to extract and remove version */
const extractAndRemoveVersion = (message: string, idx: number) => {
  const version = message.slice(0, idx) as DataPolicyVersion // "v{n}" extract only the version
  const originalMessage = message.slice(idx + 1) // extract the message
  return { version, originalMessage }
}

/** Function to extract a version from encrypted/masked message */
export const extractVersion = (messageWithVersion: string | string[]) => {
  if (Array.isArray(messageWithVersion)) {
    const lastMsg = messageWithVersion[0]
    const idx = lastMsg.indexOf(VERSION_SUFFIX)
    if (idx === -1) return { message: messageWithVersion, version: 'v0' as DataPolicyVersion }

    const { version, originalMessage } = extractAndRemoveVersion(lastMsg, idx)
    const message = [...messageWithVersion]
    message[0] = originalMessage

    return { message, version }
  }

  const idx = messageWithVersion.indexOf(VERSION_SUFFIX)

  if (idx === -1) return { message: messageWithVersion, version: 'v0' as DataPolicyVersion }

  const { version, originalMessage } = extractAndRemoveVersion(messageWithVersion as string, idx)

  return { message: originalMessage, version }
}

/**
 * Creates a verifiable object for hashed data.
 *
 * This function wraps a string or array of strings and attaches a `verify` method
 * that allows checking if a given input matches the hashed value according to
 * the provided hashing settings.
 *
 * @param {string | string[]} value - The value(s) to wrap and verify against the hash.
 * @param {HashingSettings} [settings] - Optional hashing settings, e.g., `level` of hashing.
 *
 * @returns {VerifiableObject} An object or array with an attached `verify` method
 *   to validate inputs against the hashed value(s).
 *
 * @example
 * const hashed = createVerifiableObject("myPassword", { level: "high" });
 * const isValid = await hashed.verify("myPassword"); // true or false
 */
export const createVerifiableObject = (
  value: string | string[],
  settings?: HashingSettings,
  _version?: DataPolicyVersion,
): VerifiableObject => {
  const { level = 'medium' } = settings || {}
  return Array.isArray(value)
    ? value.map((v) => Object.assign(new String(v), { verify: verifyFn(v, level) }))
    : Object.assign(new String(value), { verify: verifyFn(value, level) })
}

/**
 * Creates an unmaskable object for data protection.
 *
 * This function wraps a string or array of strings and attaches an `unmask` method
 * that allows retrieving the original (unmasked) value using the provided masking settings
 * and version. Useful for safely handling masked data while preserving the original value.
 *
 * @param {string | string[]} value - The masked value(s) to wrap.
 * @param {MaskingSettings} [settings] - Optional masking settings to use during unmasking.
 * @param {DataPolicyVersion} [version] - Optional data policy version.
 *
 * @returns {UnmaskableObject} An object or array with
 *   an attached `unmask` method that returns the original value(s).
 *
 * @example
 * const masked = createUnmaskableObject("****1234", mySettings, version);
 * const original = masked.unmask();
 */
export const createUnmaskableObject = (
  value: string | string[],
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
): UnmaskableObject => {
  // Unmask function
  const unmaskFn = () => unmask(value, settings, version)
  return Object.assign(Array.isArray(value) ? value : new String(value), {
    unmask: unmaskFn,
  }) as UnmaskableObject
}

/**
 * Creates a decryptable object for data protection.
 *
 * This function wraps a string or array of strings and attaches a `decrypt` method
 * that allows retrieving the decrypted value using the provided encryption settings
 * and version. Useful for safely handling encrypted data while preserving the original value.
 *
 * @param {string | string[]} value - The encrypted value(s) to wrap.
 * @param {EncryptSettings} [settings] - Optional encryption settings to use during decryption.
 * @param {DataPolicyVersion} [version] - Optional data policy version.
 *
 * @returns {DecryptableObject} An object or array with
 *   an attached `decrypt` method that returns the decrypted value(s).
 *
 * @example
 * const encrypted = createDecryptableObject("encryptedText", mySettings, version);
 * const decrypted = await encrypted.decrypt();
 */
export const createDecryptableObject = (
  value: string | string[],
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
): DecryptableObject => {
  // Decrypt function
  const decryptFn = () => decrypt(value, settings, version)
  return Object.assign(Array.isArray(value) ? value : new String(value), {
    decrypt: decryptFn,
  }) as DecryptableObject
}

/**
 * Hash a message using unidirectional encryption (Base64 SHA).
 *
 * @param {string | string[]} input - The message or array of messages to be hashed.
 *   Can be a single string or an array of strings. Each message will be encrypted separately.
 *
 * @param {HashingSettings} settings - The encryption settings to be used for the encryption process.
 *   For example, level `low` or `high`
 *
 * @param {DataPolicyVersion} [_version] - The version of the encryption settings. Note: it cannot be applied to hashing
 *   because hashing is one-way and cannot be reversed.
 *
 * @returns {Promise<string | string[]>} A promise that resolves to the encrypted message(s).
 *
 * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
 */
export const createHashFrom = (
  input: string | string[],
  settings?: HashingSettings,
  _version?: DataPolicyVersion,
): Promise<string | string[]> => {
  const { level = 'medium' } = settings || {}
  return Array.isArray(input)
    ? Promise.all(input.map((v) => generateHash(v, level)))
    : generateHash(input, level)
}

/**
 * Encrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
 *
 * This function automatically selects the encryption method based on the key type provided.
 *
 * @param {string | string[]} input - The message or array of messages to be encrypted.
 *   Can be a single string or an array of strings. Each message will be encrypted separately.
 *
 * @param {EncryptSettings} settings - The encryption settings to be used for the encryption process.
 *   For example, the type of encryption (`symmetric` or `asymmetric`), as well as any additional
 *   encryption-related configurations.
 *   - If the type is `symmetric`, the system will look for the environment variable `DATA_AES_KEY`.
 *   - If the type is `asymmetric`, the system will look for the environment variable `DATA_RSA_PUB`.
 *
 * @param {DataPolicyVersion} [version] - The version of the encryption settings to be applied.
 *   This corresponds to specific environment variables that define keys for different versions of encryption:
 *   - For symmetric encryption, `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
 *   - For asymmetric encryption, `DATA_RSA_PUB_V1`, `DATA_RSA_PUB_V2`, etc.
 *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
 *     `DATA_RSA_PRIVATE_KEY` as primary, and falls back to `DATA_RSA_PRIVATE_KEY`.
 *
 * @returns {Promise<string | string[]>} A promise that resolves to the encrypted message(s).
 *
 * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
 */
export const encrypt = async <T extends string | string[]>(
  input: T,
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
): Promise<T> => {
  if (!input[0]) return Promise.resolve(input)
  try {
    const { type } = settings || {}
    const key = getEncryptSecret('encrypt', type, version)
    const encrypted = await baseEncrypt(input, key)
    return appendVersion(encrypted, version) as T
  } catch (e) {
    logger.error('Encryption error', e, {
      meta: { operation: 'encrypt', source: 'zanix' },
      code: 'DATAMASTER_ENCRYPT_ERROR',
    })
    return Promise.resolve(input)
  }
}

/**
 * Decrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
 *
 * @param {string | string[]} encryptedInput - The encrypted message or array of encrypted messages to decrypt.
 *   Can be a single string or an array of strings. Each encrypted message will be decrypted separately.
 *
 * @param {EncryptSettings} settings - The decryption settings that match the settings used during encryption.
 *   This includes the type of encryption (e.g., `symmetric` or `asymmetric`), as well as any other relevant settings.
 *   - If the type was `symmetric` during encryption, ensure the same key (e.g., `DATA_AES_KEY`) is available.
 *   - If the type was `asymmetric` during encryption, ensure the corresponding private key (e.g., `DATA_RSA_PRIVATE_KEY`) is available.
 *
 * @param {DataPolicyVersion} [version] - The version of the encryption settings used during encryption.
 *   The environment variable keys for decryption must correspond to the same version used for encryption:
 *   - For symmetric encryption, use `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
 *   - For asymmetric encryption, use `DATA_RSA_PRIVATE_KEY_V1`, `DATA_RSA_PRIVATE_KEY_V2`, etc.
 *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
 *     `DATA_RSA_PRIVATE_KEY` as primary, and falls back to `DATA_RSA_PRIVATE_KEY`.
 *
 * @returns {Promise<string | string[]>} A promise that resolves to the decrypted message(s).
 *
 * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
 */
export const decrypt = async <T extends string | string[]>(
  encryptedInput: T,
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
): Promise<T> => {
  if (!encryptedInput[0]) return Promise.resolve(encryptedInput)
  try {
    const { type } = settings || {}
    const key = getEncryptSecret('decrypt', type, version)
    const decrypted = await baseDecrypt(encryptedInput, key)

    return decrypted
  } catch (e) {
    logger.error('Decryption error', e, {
      meta: { operation: 'decrypt', source: 'zanix' },
      code: 'DATAMASTER_DECRYPT_ERROR',
    })
    return Promise.resolve(encryptedInput)
  }
}

/**
 * Masks the provided message(s) using a secret key for obfuscation or reversible masking.
 *
 * @param {string | string[]} input - The message or array of messages to mask.
 *   Can be a single string or an array of strings. Each message will be masked individually.
 *
 * @param {MaskingSettings} settings - The masking configuration to be applied.
 *   Defines how masking should be performed (e.g., algorithm type, mask format, or additional options).
 *   - This method requires a secret key to perform masking.
 *   - It first checks for the environment variable `DATA_SECRET_KEY`.
 *   - If `DATA_SECRET_KEY` is not defined, it falls back to `DATA_AES_KEY`.
 *
 * @param {DataPolicyVersion} [version] - (Optional) The version of the masking policy.
 *   If provided, versioned environment variables will be used instead:
 *   - For example: `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, etc.
 *   - If those are not found, it falls back to `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
 *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
 *     `DATA_SECRET_KEY` as primary, and falls back to `DATA_AES_KEY`.
 *
 * @returns {string | string[]} A promise that resolves to the masked message(s).
 *
 * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
 */
export const mask = <T extends string | string[]>(
  input: T,
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
): T => {
  if (!input[0]) return input
  try {
    const key = getMaskSecret(version)
    return appendVersion(baseMask(input, key, settings), version) as T
  } catch (e) {
    logger.error('Masking error', e, {
      meta: { operation: 'mask', source: 'zanix' },
      code: 'DATAMASTER_MASK_ERROR',
    })
    return input
  }
}

/**
 * Unmasks (reverses) the provided masked message(s) using the same secret key and configuration
 * that were used during masking.
 *
 * @param {string | string[]} maskedInput - The masked message or array of masked messages to unmask.
 *   Can be a single string or an array of strings. Each masked value will be unmasked individually.
 *
 * @param {MaskingSettings} settings - The masking configuration that matches the one used during masking.
 *   This must correspond to the same algorithm, format, and options applied during the mask operation.
 *   - The method uses a secret key to unmask data.
 *   - It first checks for the environment variable `DATA_SECRET_KEY`.
 *   - If `DATA_SECRET_KEY` is not defined, it falls back to `DATA_AES_KEY`.
 *
 * @param {DataPolicyVersion} [version] - (Optional) The version of the masking policy used.
 *   If provided, versioned environment variables will be referenced:
 *   - For example: `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, etc.
 *   - If those are not found, it falls back to `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
 *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
 *     `DATA_SECRET_KEY` as primary, and falls back to `DATA_AES_KEY`.
 *
 * @returns {string | string[]} A promise that resolves to the original unmasked message(s).
 *
 * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
 */
export const unmask = <T extends string | string[]>(
  maskedInput: T,
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
): T => {
  if (!maskedInput[0]) return maskedInput
  try {
    const key = getMaskSecret(version)
    return baseUnmask(maskedInput, key, settings)
  } catch (e) {
    logger.error('Unmasking error', e, {
      meta: { operation: 'unmask', source: 'zanix' },
      code: 'DATAMASTER_UNMASK_ERROR',
    })
    return maskedInput
  }
}
