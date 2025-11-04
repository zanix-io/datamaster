import { generateHash, validateHash } from '@zanix/helpers'

// Hashing function
const verifyFn = (hash: string) => (input: string) => validateHash(input, hash)

/**
 * Create verify object for data protection getter
 * @param value
 * @returns
 */
export const createVerifyObject = (value: string | string[]) => {
  return Array.isArray(value)
    ? value.map((v) => Object.assign(new String(v), { verify: verifyFn(v) }))
    : Object.assign(new String(value), { verify: verifyFn(value) })
}

/**
 * Create hash of array and string
 * @param value
 * @returns
 */
export const createHashFrom = (value: string | string[], level: 'low' | 'medium') => {
  return Array.isArray(value)
    ? Promise.all(value.map((v) => generateHash(v, level)))
    : generateHash(value, level)
}

/**
 * Create decrypt object for data protection getter
 * @param value
 * @param encryptMethod
 * @returns
 */
export const createDecryptObject = (
  value: string | string[],
  encryptMethod: 'asym-encrypt' | 'sym-encrypt',
) => {
  // Decrypt function
  const decryptFn = () => decrypt(value, encryptMethod)
  return Object.assign(new String(value), { decrypt: decryptFn })
}

import type { MaskingBaseOptions } from '@zanix/types'

import logger from '@zanix/logger'
import {
  decrypt as baseDecrypt,
  encrypt as baseEncrypt,
  mask as baseMask,
  unmask as baseUnmask,
} from '@zanix/helpers'

/**
 * Decrypts data previously encrypted with `encrypt`.
 *
 * When type `asym` is defined, it first checks for the environment `base64` variable `DATABASE_RSA_KEY`,
 * if not found, it falls back to `DATABASE_AES_KEY` and applies 'sym-encrypt' method.
 */
export const decrypt = (
  message: string | string[],
  type: 'sym-encrypt' | 'asym-encrypt' = 'sym-encrypt',
) => {
  try {
    const rsaKey = Deno.env.get('DATABASE_RSA_KEY')
    const key = rsaKey && type === 'asym-encrypt' ? atob(rsaKey) : Deno.env.get('DATABASE_AES_KEY')

    if (!key) {
      logger.warn(
        'Decryption key missing: define a valid DATABASE_AES_KEY or a base64 `DATABASE_RSA_KEY` in your environment.',
      )
      return Promise.resolve(message)
    }

    return baseDecrypt(message, key)
  } catch {
    return Promise.resolve(message)
  }
}

/**
 * Encrypts one or more messages using AES.
 *
 * When type `asym` is defined, it first checks for the environment `base64` variable `DATABASE_RSA_PUB`,
 * if not found, it falls back to `DATABASE_AES_KEY` and applies 'sym-decrypt' method.
 */
export const encrypt = (
  message: string | string[],
  type: 'sym-encrypt' | 'asym-encrypt' = 'sym-encrypt',
) => {
  try {
    const rsaKey = Deno.env.get('DATABASE_RSA_PUB')
    const key = rsaKey && type === 'asym-encrypt' ? atob(rsaKey) : Deno.env.get('DATABASE_AES_KEY')
    if (!key) {
      logger.warn(
        'Encryption key missing: define a valid `DATABASE_AES_KEY` or a base64 `DATABASE_RSA_PUB` in your environment.',
      )
      return Promise.resolve(message)
    }
    return baseEncrypt(message, key)
  } catch {
    return Promise.resolve(message)
  }
}

/**
 * Masks the text or array of texts. Used for sensible data access
 *
 * 🔒 **Security Notes:**
 * - Never hardcode masking keys in source code.
 * - Prefer setting the `DATABASE_SECRET_KEY` environment variable securely.
 */
export const mask = (input: string | string[], options?: MaskingBaseOptions) => {
  const key = Deno.env.get('DATABASE_SECRET_KEY') || Deno.env.get('DATABASE_AES_KEY')
  if (!key) {
    logger.warn(
      'Masking key missing: please define DATABASE_SECRET_KEY or DATABASE_AES_KEY in your environment.',
    )
    return input
  }
  return baseMask(input, key, options)
}

/**
 * Unmasks the text or array of texts. Used for sensible data access
 *
 * 🔒 **Security Notes:**
 * - Never hardcode masking keys in source code.
 * - Prefer setting the `DATABASE_SECRET_KEY` environment variable securely.
 */
export const unmask = (input: string | string[], options?: MaskingBaseOptions) => {
  const key = Deno.env.get('DATABASE_SECRET_KEY') || Deno.env.get('DATABASE_AES_KEY')
  if (!key) {
    logger.warn(
      'Unmasking key missing: please define DATABASE_SECRET_KEY or DATABASE_AES_KEY in your environment.',
    )
    return input
  }
  return baseUnmask(input, key, options)
}
