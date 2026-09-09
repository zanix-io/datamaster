/**
 * A REAL, disk-backed `ObjectStorage` — the dev/test/fallback counterpart to
 * `S3ObjectStorage`. **Not the intended production object store** — a real deployment's
 * bytes belong in a real object store (`S3ObjectStorage`); this exists for local
 * development with zero external infra, and as the local half of `createFallbackObjectStorage`'s
 * own S3-with-local-fallback composition (`fallback-object-storage.ts`).
 *
 * `key` (e.g. `'assets/<id>/original'`) maps directly onto a nested path under `rootDir` — no
 * translation, no extension appended: the logical key IS the relative path.
 *
 * Ported from `@zanix/space`'s own `LocalFilesystemAssetStorage` (`assets-api/adapters/`) — that
 * package's copy stays as its own dev-adapter for `AssetStorage`; this one is the generic
 * `ObjectStorage` counterpart, so this package's own migration/fallback helpers (which operate on
 * `ObjectStorage`, not any asset-specific port) have a real local implementation to compose with,
 * without importing `@zanix/space`.
 *
 * @module
 */

import type { ObjectStorage, StorageEncryptSettings, StoredObject } from './typings/general.ts'

import { dirname } from '@std/path'
import { confinePath } from '@zanix/helpers'
import { checksumOf, readAllBytes } from './bytes.ts'
import { decryptBytes, encryptBytes, ENCRYPTION_VERSION_METADATA } from './encryption.ts'

// `key` is caller-supplied (ultimately, in `@zanix/space`'s Asset API, an HTTP route param) —
// `confinePath` rejects one that would resolve outside `rootDir` (`../` traversal, or an absolute
// `key` overriding `rootDir` outright) instead of letting `put`/`get`/`delete` touch disk there.
function bytesPath(rootDir: string, key: string): string {
  return confinePath(rootDir, key)
}

/** A sidecar file next to the real bytes — `StoredObject`'s own properties (`contentType`/
 * `checksum`) aren't derivable from the raw bytes alone (a real backend would carry this as
 * object metadata/headers instead; a plain filesystem has no such concept, so this is this
 * adapter's own, local-only way of not losing it). When the object is encrypted, this same file
 * also carries whatever `encryptBytes` returned as metadata (`ENCRYPTION_VERSION_METADATA`,
 * and `WRAPPED_KEY_METADATA` for `'asymmetric'` objects) — the local-disk equivalent of the S3
 * object metadata `S3ObjectStorage` carries the same fields as. */
function metaPath(rootDir: string, key: string): string {
  return confinePath(rootDir, `${key}.meta.json`)
}

/** The sidecar file's on-disk shape: `StoredObject`'s own public fields, plus — only for an
 * encrypted object — whatever `encryptBytes` returned as metadata, nested under `encryption`
 * rather than flattened alongside `StoredObject`'s own fields (which include a numeric `size`,
 * incompatible with the all-string `Record<string, string>` shape `encryptBytes`/`decryptBytes`
 * exchange). The same fields `S3ObjectStorage` carries as S3 object metadata. */
type StoredObjectFile = StoredObject & { encryption?: Record<string, string> }

/**
 * Builds a disk-backed `ObjectStorage` rooted at `rootDir` — created lazily (`Deno.mkdir(...,
 * {recursive: true})` on first `put()`), never assumed to already exist.
 *
 * `options.encrypt`, when set, encrypts bytes at rest via the same `encryptBytes`/`decryptBytes`
 * (`'symmetric'`/`'asymmetric'`, `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY`, key-version
 * rotation) `S3ObjectStorage` uses — see `encryption.ts`'s own doc for the full mechanism.
 * Omitted (the default): bytes are written and read back exactly as given, unchanged from before
 * this option existed. Unlike `S3ObjectStorage`'s own `encrypt` option, there is no env-var
 * fallback here — this factory is always called with explicit arguments by its own callers
 * (`createFallbackObjectStorage`, `@zanix/core`'s `Zanix.setup({assets})`), never constructed
 * through a zero-config DI path that would need one.
 */
export function createLocalFilesystemObjectStorage(
  rootDir: string,
  options: { encrypt?: StorageEncryptSettings } = {},
): ObjectStorage {
  const encrypt = options.encrypt

  return {
    async put(key, data, meta) {
      const plaintext = await readAllBytes(data)
      const checksum = await checksumOf(plaintext)
      const object: StoredObject = {
        key,
        contentType: meta.contentType,
        size: plaintext.byteLength,
        checksum,
      }

      let bytes: Uint8Array = plaintext
      const file: StoredObjectFile = { ...object }
      if (encrypt) {
        const encrypted = await encryptBytes(plaintext, encrypt)
        bytes = encrypted.ciphertext
        file.encryption = encrypted.metadata
      }

      const target = bytesPath(rootDir, key)
      await Deno.mkdir(dirname(target), { recursive: true })
      await Deno.writeFile(target, bytes)
      await Deno.writeTextFile(metaPath(rootDir, key), JSON.stringify(file))
      return object
    },

    async get(key) {
      try {
        const file = JSON.parse(
          await Deno.readTextFile(metaPath(rootDir, key)),
        ) as StoredObjectFile
        const raw = await Deno.readFile(bytesPath(rootDir, key))
        // Same "only the object's own recorded metadata means real ciphertext" rule
        // `S3ObjectStorage.get()` follows — this instance's own `encrypt` option only means it's
        // CONFIGURED to decrypt, not that this particular object was ever actually encrypted (it
        // may have been written before `encrypt` was set, or by an instance without it).
        const isEncrypted = Boolean(encrypt) &&
          file.encryption?.[ENCRYPTION_VERSION_METADATA] !== undefined
        const bytes = isEncrypted && encrypt
          ? await decryptBytes(raw, encrypt, file.encryption)
          : raw
        const object: StoredObject = {
          key: file.key,
          contentType: file.contentType,
          size: bytes.byteLength,
          checksum: file.checksum,
        }
        return {
          object,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined
        throw error
      }
    },

    async delete(key) {
      await Deno.remove(bytesPath(rootDir, key)).catch(() => {})
      await Deno.remove(metaPath(rootDir, key)).catch(() => {})
    },

    async exists(key) {
      try {
        await Deno.stat(bytesPath(rootDir, key))
        return true
      } catch {
        return false
      }
    },
  }
}
