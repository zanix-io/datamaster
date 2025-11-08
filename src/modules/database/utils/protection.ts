import type { HashedString } from 'typings/data.ts'
import type {
  DataPolicyVersion,
  EncryptSettings,
  HashingLevels,
  HashingSettings,
  MaskingSettings,
} from 'database/typings/protection.ts'

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

  logger.warn(error)
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

/** Create hash of array and string */
export const createHashFrom = (
  value: string | string[],
  settings?: HashingSettings,
  _version?: DataPolicyVersion,
) => {
  const { level = 'medium' } = settings || {}
  return Array.isArray(value)
    ? Promise.all(value.map((v) => generateHash(v, level)))
    : generateHash(value, level)
}

/** Create verify object for data protection getter */
export const createVerifyObject = (
  value: string | string[],
  settings?: HashingSettings,
  _version?: DataPolicyVersion,
): HashedString => {
  const { level = 'medium' } = settings || {}
  return Array.isArray(value)
    ? value.map((v) => Object.assign(new String(v), { verify: verifyFn(v, level) }))
    : Object.assign(new String(value), { verify: verifyFn(value, level) })
}

/** Create unmask object for data protection getter */
export const createUnmaskObject = (
  value: string | string[],
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
) => {
  // Unmask function
  const unmaskFn = () => unmask(value, settings, version)
  return Object.assign(Array.isArray(value) ? value : new String(value), { unmask: unmaskFn })
}

/** Create decrypt object for data protection getter */
export const createDecryptObject = (
  value: string | string[],
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
) => {
  // Decrypt function
  const decryptFn = () => decrypt(value, settings, version)
  return Object.assign(Array.isArray(value) ? value : new String(value), { decrypt: decryptFn })
}

/**
 * Encrypts one or more messages using AES or RSA. */
export const encrypt = async (
  message: string | string[],
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
) => {
  if (!message[0]) return Promise.resolve(message)
  try {
    const { type } = settings || {}
    const key = getEncryptSecret('encrypt', type, version)
    const encrypted = await baseEncrypt(message, key)
    return appendVersion(encrypted, version)
  } catch (e) {
    logger.error('Encryption error:', e)
    return Promise.resolve(message)
  }
}

/**
 * Decrypts data previously encrypted with `encrypt`.
 */
export const decrypt = async (
  message: string | string[],
  settings?: EncryptSettings,
  version?: DataPolicyVersion,
) => {
  if (!message[0]) return Promise.resolve(message)
  try {
    const { type } = settings || {}
    const key = getEncryptSecret('decrypt', type, version)
    const decrypted = await baseDecrypt(message, key)

    return decrypted
  } catch (e) {
    logger.error('Decryption error:', e)
    return Promise.resolve(message)
  }
}

/** Masks the text or array of texts. Used for sensible data access */
export const mask = (
  input: string | string[],
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
) => {
  if (!input[0]) return input
  try {
    const key = getMaskSecret(version)
    return appendVersion(baseMask(input, key, settings), version)
  } catch (e) {
    logger.error('Masking error:', e)
    return input
  }
}

/** Unmasks the text or array of texts. Used for sensible data access */
export const unmask = (
  input: string | string[],
  settings?: MaskingSettings,
  version?: DataPolicyVersion,
) => {
  if (!input[0]) return input
  try {
    const key = getMaskSecret(version)
    return baseUnmask(input, key, settings)
  } catch (e) {
    logger.error('Unmasking error:', e)
    return input
  }
}
