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

import type { ObjectStorage, StoredObject } from './typings/general.ts'

import { dirname } from '@std/path'
import { confinePath } from '@zanix/helpers'
import { checksumOf, readAllBytes } from './bytes.ts'

// `key` is caller-supplied (ultimately, in `@zanix/space`'s Asset API, an HTTP route param) —
// `confinePath` rejects one that would resolve outside `rootDir` (`../` traversal, or an absolute
// `key` overriding `rootDir` outright) instead of letting `put`/`get`/`delete` touch disk there.
function bytesPath(rootDir: string, key: string): string {
  return confinePath(rootDir, key)
}

/** A sidecar file next to the real bytes — `StoredObject`'s own properties (`contentType`/
 * `checksum`) aren't derivable from the raw bytes alone (a real backend would carry this as
 * object metadata/headers instead; a plain filesystem has no such concept, so this is this
 * adapter's own, local-only way of not losing it). */
function metaPath(rootDir: string, key: string): string {
  return confinePath(rootDir, `${key}.meta.json`)
}

/**
 * Builds a disk-backed `ObjectStorage` rooted at `rootDir` — created lazily (`Deno.mkdir(...,
 * {recursive: true})` on first `put()`), never assumed to already exist.
 */
export function createLocalFilesystemObjectStorage(rootDir: string): ObjectStorage {
  return {
    async put(key, data, meta) {
      const buffer = await readAllBytes(data)
      const checksum = await checksumOf(buffer)
      const object: StoredObject = {
        key,
        contentType: meta.contentType,
        size: buffer.byteLength,
        checksum,
      }
      const target = bytesPath(rootDir, key)
      await Deno.mkdir(dirname(target), { recursive: true })
      await Deno.writeFile(target, buffer)
      await Deno.writeTextFile(metaPath(rootDir, key), JSON.stringify(object))
      return object
    },

    async get(key) {
      try {
        const object = JSON.parse(await Deno.readTextFile(metaPath(rootDir, key))) as StoredObject
        const buffer = await Deno.readFile(bytesPath(rootDir, key))
        return {
          object,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(buffer)
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
