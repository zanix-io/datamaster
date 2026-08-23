import type { DataPolicyVersion, StorageEncryptSettings } from './typings/general.ts'

import { InternalError } from '@zanix/errors'
import {
  base64ToUint8Array,
  decrypt as rsaDecrypt,
  decryptAES,
  encrypt as rsaEncrypt,
  encryptAES,
  generateAESKey,
  stringToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToString,
} from '@zanix/helpers'

/** Metadata key an encrypted object's wrapped per-object AES key is stored under, when
 * `encrypt.type === 'asymmetric'`. Absent for `'symmetric'` objects — the shared `DATA_AES_KEY`
 * decrypts those directly, nothing per-object to carry. */
export const WRAPPED_KEY_METADATA = 'wrapped-key'

/** Metadata key the key VERSION an object was encrypted under is stored as — see this module's own
 * top-level doc for why decryption always uses the object's OWN recorded version, never whatever
 * version is currently active for new writes. Absent means `'v0'` (the implicit default,
 * unsuffixed key — same convention `utils/protection.ts`'s own `extractVersion` uses), covering
 * objects encrypted before this feature existed. */
export const ENCRYPTION_VERSION_METADATA = 'encryption-version'

/** Same suffix rule `utils/protection.ts`'s own (unexported) `normalizeSecretVersion` uses —
 * duplicated rather than imported since it's two lines of pure logic and keeps this module's own
 * dependency footprint self-contained; the env var NAMES it produces are what actually needs to
 * match, and those are asserted identical in this module's own tests. */
const normalizeVersion = (version?: DataPolicyVersion): string =>
  version && version !== 'v0' ? `_${version.toUpperCase()}` : ''

/**
 * Resolves the env var an `encrypt` setting's key must come from — mirrors
 * `utils/protection.ts`'s own `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY` convention exactly
 * (including the `_V1`/`_V2`/... versioned-key suffix), so this feature never introduces a
 * parallel key-naming or rotation scheme. Unlike `utils/protection.ts`'s `encrypt`/`decrypt`, a
 * missing key throws here rather than silently falling back — see this module's own top-level doc
 * for why that distinction matters for file content specifically.
 */
const requireEnv = (name: string): string => {
  const value = Deno.env.get(name)
  if (!value) {
    // A native `Error` here previously — this is exactly what `InternalError` is for: a config
    // invariant violated with no way the caller could have prevented it (encryption was already
    // enabled, but the key it needs isn't there). See `@zanix/errors`' docs, "Choosing a class".
    throw new InternalError(
      `Object storage encryption is enabled but '${name}' is not set in the environment.`,
      { code: 'OBJECT_STORAGE_ENCRYPTION_ENV_MISSING', meta: { envVar: name } },
    )
  }
  return value
}

/**
 * Encrypts/decrypts stored bytes at rest for {@link S3ObjectStorage} — deliberately separate
 * from `utils/protection.ts`'s `encrypt`/`decrypt` (used for Mongo field-level masking elsewhere in
 * this package). Those wrappers catch every error and return the original input unencrypted,
 * logging the failure — an acceptable trade-off for a PII field where the alternative is breaking a
 * write entirely, but a silent, dangerous default here: a caller who explicitly asked for file
 * content to be encrypted has to be able to trust that `put()` either encrypted it or failed loudly,
 * never that it silently stored plaintext under an "encrypted" label.
 *
 * Reuses `@zanix/helpers`' own AES-GCM/RSA-OAEP primitives (`encryptAES`/`decryptAES`/`encrypt`/
 * `decrypt`) directly, and the SAME `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY` environment
 * variables the rest of this package's data-protection story already uses (see
 * `utils/protection.ts`) — no S3-specific key variables.
 *
 * `'symmetric'` encrypts the object's bytes directly with `DATA_AES_KEY`. `'asymmetric'` uses real
 * envelope encryption: RSA-OAEP has a hard payload-size ceiling far below a typical object's size, so
 * it can never encrypt file content directly — instead, a random AES key is generated per object
 * (`generateAESKey`), that key encrypts the bytes, and only the (small) key itself is RSA-encrypted
 * with `DATA_RSA_PUB` and carried alongside the object as storage metadata (see
 * `WRAPPED_KEY_METADATA`).
 *
 * Key rotation reuses the exact same `_V1`/`_V2`/... versioned-key convention
 * `utils/protection.ts`/`dataProtectionGetter` already establish: `encrypt.version` selects which
 * versioned key NEW writes use (`DATA_AES_KEY_V2`, say), while each object's own version is
 * recorded as storage metadata (`ENCRYPTION_VERSION_METADATA`) at `put()` time and read back at
 * `get()` time — so rotating the active version only affects future writes; existing objects keep
 * decrypting correctly under whichever key version they were actually written with, as long as
 * that older key stays available (same operational requirement `docs/configuration.md`'s own
 * "Security" section already states for field-level rotation: never remove an old key version
 * while any data still depends on it).
 *
 * @module
 */

/** Result of encrypting one object's bytes: the ciphertext to store, plus any extra metadata the
 * matching `decryptBytes` call will need back (the encryption version always; the wrapped key only
 * for `'asymmetric'`). */
export interface EncryptBytesResult {
  ciphertext: Uint8Array
  metadata: Record<string, string>
}

/** Encrypts `plaintext` per `settings`, throwing if the required (possibly versioned) key isn't
 * configured. */
export async function encryptBytes(
  plaintext: Uint8Array,
  settings: StorageEncryptSettings,
): Promise<EncryptBytesResult> {
  const suffix = normalizeVersion(settings.version)
  const plaintextBase64 = uint8ArrayToBase64(plaintext)
  const metadata: Record<string, string> = {
    [ENCRYPTION_VERSION_METADATA]: settings.version ?? 'v0',
  }

  if (settings.type === 'asymmetric') {
    const objectKey = await generateAESKey(256)
    const ciphertextBase64 = await encryptAES(plaintextBase64, objectKey)
    const rsaPublicKey = requireEnv(`DATA_RSA_PUB${suffix}`)
    const wrappedKey = await rsaEncrypt(objectKey, atob(rsaPublicKey), 'RSA')
    return {
      ciphertext: stringToUint8Array(ciphertextBase64),
      metadata: { ...metadata, [WRAPPED_KEY_METADATA]: wrappedKey },
    }
  }

  const aesKey = requireEnv(`DATA_AES_KEY${suffix}`)
  const ciphertextBase64 = await encryptAES(plaintextBase64, aesKey)
  return { ciphertext: stringToUint8Array(ciphertextBase64), metadata }
}

/** Decrypts bytes previously produced by {@link encryptBytes}, given the same `settings.type` and
 * whatever `metadata` the object was stored with — critically, the VERSION used is always the
 * object's own recorded one (`metadata[ENCRYPTION_VERSION_METADATA]`), never `settings.version`:
 * rotating the active version must never break decrypting objects written under an older one. */
export async function decryptBytes(
  ciphertext: Uint8Array,
  settings: StorageEncryptSettings,
  metadata: Record<string, string> = {},
): Promise<Uint8Array> {
  const objectVersion = (metadata[ENCRYPTION_VERSION_METADATA] as DataPolicyVersion) || 'v0'
  const suffix = normalizeVersion(objectVersion)
  const ciphertextBase64 = uint8ArrayToString(ciphertext)

  if (settings.type === 'asymmetric') {
    const wrappedKey = metadata[WRAPPED_KEY_METADATA]
    if (!wrappedKey) {
      // An object recorded as asymmetrically-encrypted but missing the metadata that says how to
      // unwrap its key — data-integrity fault on the stored object itself, not a caller mistake.
      throw new InternalError(
        `Cannot decrypt: object is missing its '${WRAPPED_KEY_METADATA}' metadata.`,
        {
          code: 'OBJECT_STORAGE_DECRYPT_METADATA_MISSING',
          meta: { metadataKey: WRAPPED_KEY_METADATA },
        },
      )
    }
    const rsaPrivateKey = requireEnv(`DATA_RSA_KEY${suffix}`)
    const objectKey = await rsaDecrypt(wrappedKey, atob(rsaPrivateKey), 'RSA')
    const plaintextBase64 = await decryptAES(ciphertextBase64, objectKey)
    return base64ToUint8Array(plaintextBase64)
  }

  const aesKey = requireEnv(`DATA_AES_KEY${suffix}`)
  const plaintextBase64 = await decryptAES(ciphertextBase64, aesKey)
  return base64ToUint8Array(plaintextBase64)
}
