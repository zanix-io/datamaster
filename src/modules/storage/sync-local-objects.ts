/**
 * A one-time, lazy, memoized copy of every object already sitting in a local fallback directory
 * into a primary (real) `ObjectStorage` — the same "sync on first real use, once per process"
 * pattern `@zanix/notifications`' own `LocalTemplateBackend` (`db/local-backend.ts`) already
 * establishes for code→database template syncing: `ensureLocalObjectsSynced()` memoizes a
 * module-level promise, resets it on failure (so the NEXT call retries), and does the real work in
 * a separate function. Triggered from `createFallbackObjectStorage`'s own read/write path
 * (`fallback-object-storage.ts`), never eagerly at boot — nothing walks the local directory at all
 * for a deployment that never had one.
 *
 * Existence-based, not content-diffed: objects are treated as immutable once written
 * (checksum-identified), so "does the primary already have this key" is the complete, correct
 * check; there's no "changed since last sync" case to reconcile.
 *
 * Ported from `@zanix/space`'s own test-support reference example (`sync-local-assets-to-s3.ts`)
 * into a real, published, generic export — it never depended on anything asset-specific (walks a
 * plain directory tree against two `ObjectStorage`s), so the move changes nothing about its own
 * behavior.
 *
 * @module
 */

import type { ObjectStorage } from './typings/general.ts'

import { join, relative, SEPARATOR } from '@std/path'
import logger from '@zanix/logger'

/** Module-level, once-per-process sync memo — mirrors `LocalTemplateBackend`'s own `syncPromise`
 * convention. Reset only in tests. */
let syncPromise: Promise<void> | undefined

/** Resets the module-level sync memo — test-only. */
export function resetLocalObjectsSyncState(): void {
  syncPromise = undefined
}

/** The sidecar suffix `LocalFilesystemObjectStorage` (`local-filesystem-object-storage.ts`) writes
 * each object's own metadata under — walked past, never treated as an object of its own. */
const META_SUFFIX = '.meta.json'

/** Yields every real object key stored under `rootDir` — the relative path from `rootDir` to each
 * non-sidecar file, normalized to the same `/`-separated form every `ObjectStorage` key already
 * uses (real on every OS `LocalFilesystemObjectStorage` actually runs on, but normalized
 * defensively regardless). A `rootDir` that doesn't exist yet (no local writes ever happened)
 * yields nothing — not an error.
 *
 * `currentDir` is the directory actually being walked at this recursion depth; `rootDir` stays
 * fixed at the ORIGINAL call's argument throughout — `relative()` must always be computed against
 * that fixed root, never against whichever subdirectory a recursive call happens to be walking, or
 * a nested key like `"nested/b"` would come back as just `"b"`. `Deno.readDir()` itself never
 * throws (it's lazy — the directory is only actually opened once iteration starts), so the
 * NotFound check has to wrap the `for await` below, not the call that creates it. */
async function* localObjectKeys(
  currentDir: string,
  rootDir: string = currentDir,
): AsyncGenerator<string> {
  try {
    for await (const entry of Deno.readDir(currentDir)) {
      const full = join(currentDir, entry.name)
      if (entry.isDirectory) {
        yield* localObjectKeys(full, rootDir)
      } else if (entry.isFile && !entry.name.endsWith(META_SUFFIX)) {
        yield relative(rootDir, full).split(SEPARATOR).join('/')
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

async function syncLocalObjects(
  local: ObjectStorage,
  primary: ObjectStorage,
  rootDir: string,
): Promise<void> {
  let migrated = 0
  for await (const key of localObjectKeys(rootDir)) {
    if (await primary.exists(key)) continue
    const found = await local.get(key)
    if (!found) continue // raced with a concurrent delete — nothing to migrate
    await primary.put(key, found.stream, { contentType: found.object.contentType })
    migrated++
  }
  if (migrated > 0) {
    logger.warn(
      `Migrated ${migrated} local object(s) into the primary ObjectStorage on first use.`,
      {
        code: 'OBJECT_STORAGE_MIGRATED',
        meta: { migrated },
      },
    )
  }
}

/**
 * Ensures the local-directory-to-primary migration has run exactly once for this process. Safe to
 * call on every read/write — after the first real call, subsequent ones resolve immediately
 * against the memoized promise (its `local`/`primary`/`rootDir` arguments captured then, exactly
 * like `LocalTemplateBackend`'s own `#ensureSynced()` — later calls' arguments are irrelevant once
 * the first call is already in flight or done, since there's realistically one object storage
 * configuration per process). On failure, resets the memo so the NEXT call retries the full walk
 * rather than caching a permanent failure.
 */
export function ensureLocalObjectsSynced(
  local: ObjectStorage,
  primary: ObjectStorage,
  rootDir: string,
): Promise<void> {
  if (!syncPromise) {
    syncPromise = syncLocalObjects(local, primary, rootDir).catch((error) => {
      syncPromise = undefined
      throw error
    })
  }
  return syncPromise
}
