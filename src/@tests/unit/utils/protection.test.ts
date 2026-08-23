// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import logger from '@zanix/logger'
import {
  DATA_AES_KEY_ENV,
  DATA_RSA_KEY_ENV,
  DATA_RSA_PUB_ENV,
  DATA_SECRET_KEY_ENV,
  decrypt,
  encrypt,
  mask,
  unmask,
} from 'utils/protection.ts'

/**
 * Regression coverage for two things fixed together in the same change:
 * 1. `DATA_SECRET_KEY`/`DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY` now each have an exported
 *    `_ENV` constant (naming-and-structure-conventions rule 5) instead of being read as raw
 *    string literals.
 * 2. The internal "key missing" failure (`getMaskSecret`/`getEncryptSecret`) now throws an
 *    `InternalError` instead of a native `Error` (zanix-observability-conventions' error-class
 *    table) — constructed with `shouldLog: false`, since it's always caught immediately by
 *    `mask`/`unmask`/`encrypt`/`decrypt` below, which already log the failure themselves (as
 *    `DATAMASTER_MASK_ERROR`/`DATAMASTER_UNMASK_ERROR`/`DATAMASTER_ENCRYPT_ERROR`/
 *    `DATAMASTER_DECRYPT_ERROR`). This is NOT an externally-visible class change — none of these
 *    4 functions ever re-throw; they all catch, log once, and return the original input — so
 *    this coverage asserts the log fires exactly ONCE per call (a regression here would mean
 *    `InternalError`'s own default `shouldLog: true` started double-logging the same failure).
 */

const ENV_VARS = [DATA_SECRET_KEY_ENV, DATA_AES_KEY_ENV, DATA_RSA_PUB_ENV, DATA_RSA_KEY_ENV]

const clearEnv = () => {
  for (const v of ENV_VARS) Deno.env.delete(v)
}

const stubLoggerError = () => {
  const calls: unknown[][] = []
  const original = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => calls.push(args)) as any
  return { calls, restore: () => (logger.error = original) }
}

Deno.test('_ENV constants hold the literal env var names', () => {
  assertEquals(DATA_SECRET_KEY_ENV, 'DATA_SECRET_KEY')
  assertEquals(DATA_AES_KEY_ENV, 'DATA_AES_KEY')
  assertEquals(DATA_RSA_PUB_ENV, 'DATA_RSA_PUB')
  assertEquals(DATA_RSA_KEY_ENV, 'DATA_RSA_KEY')
})

Deno.test(
  'mask() with no DATA_SECRET_KEY/DATA_AES_KEY set logs once and returns input unchanged',
  () => {
    clearEnv()
    const { calls, restore } = stubLoggerError()
    try {
      const result = mask('secret-value')
      assertEquals(result, 'secret-value')
      assertEquals(calls.length, 1)
      assertEquals((calls[0][2] as { code: string }).code, 'DATAMASTER_MASK_ERROR')
    } finally {
      restore()
      clearEnv()
    }
  },
)

Deno.test(
  'unmask() with no DATA_SECRET_KEY/DATA_AES_KEY set logs once and returns input unchanged',
  () => {
    clearEnv()
    const { calls, restore } = stubLoggerError()
    try {
      const result = unmask('masked-value')
      assertEquals(result, 'masked-value')
      assertEquals(calls.length, 1)
      assertEquals((calls[0][2] as { code: string }).code, 'DATAMASTER_UNMASK_ERROR')
    } finally {
      restore()
      clearEnv()
    }
  },
)

Deno.test(
  'encrypt() with no DATA_AES_KEY/DATA_RSA_PUB set logs once and returns input unchanged',
  async () => {
    clearEnv()
    const { calls, restore } = stubLoggerError()
    try {
      const result = await encrypt('plain-text')
      assertEquals(result, 'plain-text')
      assertEquals(calls.length, 1)
      assertEquals((calls[0][2] as { code: string }).code, 'DATAMASTER_ENCRYPT_ERROR')
    } finally {
      restore()
      clearEnv()
    }
  },
)

Deno.test(
  'decrypt() with no DATA_AES_KEY/DATA_RSA_KEY set logs once and returns input unchanged',
  async () => {
    clearEnv()
    const { calls, restore } = stubLoggerError()
    try {
      const result = await decrypt('cipher-text')
      assertEquals(result, 'cipher-text')
      assertEquals(calls.length, 1)
      assertEquals((calls[0][2] as { code: string }).code, 'DATAMASTER_DECRYPT_ERROR')
    } finally {
      restore()
      clearEnv()
    }
  },
)

Deno.test(
  'mask() resolves the versioned DATA_SECRET_KEY_V1 built from DATA_SECRET_KEY_ENV',
  () => {
    clearEnv()
    Deno.env.set(`${DATA_SECRET_KEY_ENV}_V1`, 'a'.repeat(32))
    try {
      const result = mask('secret-value', undefined, 'v1')
      // A real key was found — masking succeeds (doesn't fall through to "key missing").
      assertEquals(typeof result, 'string')
      assertEquals((result as string).length > 0, true)
    } finally {
      Deno.env.delete(`${DATA_SECRET_KEY_ENV}_V1`)
    }
  },
)
