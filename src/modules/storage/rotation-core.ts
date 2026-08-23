/**
 * The actual enumerate-and-migrate work behind `rotation.ts`'s public
 * `checkEncryptionRotationStatus()`/`rotateEncryptionKeys()` — split into its own module so it can
 * be called from two different places with the exact same logic: directly, on the calling thread,
 * or reconstructed inside a worker thread by `rotation-worker.ts` (see `rotation.ts`'s `useWorker`
 * option). Nothing in this file is exported from `mod.ts` — it's an internal implementation detail,
 * not part of this package's public API.
 *
 * @module
 */

import { InternalError } from '@zanix/errors'
import type { S3ObjectStorage } from './connector.ts'
import type { DataPolicyVersion } from './typings/general.ts'
import type {
  EncryptionRotationStatus,
  EncryptionRotationStatusOptions,
  RotationOptionsWithoutWorker,
  RotationResult,
} from './rotation.ts'

/** Shared "this instance has no active version to migrate towards" guard — reused by both
 * `runCheck` and `runRotate`. */
export function requireActiveVersion(storage: S3ObjectStorage): DataPolicyVersion {
  const settings = storage.encryptSettings
  if (!settings) {
    // A native `Error` here previously — see `@zanix/errors`' docs, "Choosing a class": this is an
    // internal misconfiguration (an ops/admin operation invoked against an instance that was never
    // set up for it), not a validation of some external caller's input.
    throw new InternalError(
      'Cannot check/rotate encryption: this S3ObjectStorage instance has encryption ' +
        'disabled (no `encrypt` configured) — there is no "active version" to migrate objects to.',
      { code: 'OBJECT_STORAGE_ROTATION_NOT_CONFIGURED' },
    )
  }
  return settings.version ?? 'v0'
}

/** Shared pagination walk — yields every key in the bucket (optionally scoped to `prefix`), one at
 * a time, hiding `ListObjectsV2Command`'s own `ContinuationToken` bookkeeping from both functions
 * below. */
async function* walkKeys(
  storage: S3ObjectStorage,
  prefix: string | undefined,
  maxKeysPerPage: number | undefined,
): AsyncGenerator<string> {
  let continuationToken: string | undefined
  do {
    // Inherently sequential — page N+1 can't be requested without page N's own continuation
    // token, so there's nothing here for `Promise.all` to parallelize.
    // deno-lint-ignore no-await-in-loop
    const page = await storage.listPage({ prefix, continuationToken, maxKeys: maxKeysPerPage })
    for (const key of page.keys) yield key
    continuationToken = page.nextContinuationToken
  } while (continuationToken)
}

/** The real work behind `checkEncryptionRotationStatus()` — read-only, walks every key via
 * `listPage()`/`getMetadata()`. */
export async function runCheck(
  storage: S3ObjectStorage,
  options: EncryptionRotationStatusOptions,
): Promise<EncryptionRotationStatus> {
  const activeVersion = requireActiveVersion(storage)

  let totalObjects = 0
  let onActiveVersion = 0
  let unencrypted = 0
  const versionsStillInUse = new Set<DataPolicyVersion>()

  for await (const key of walkKeys(storage, options.prefix, options.maxKeysPerPage)) {
    totalObjects++
    const metadata = await storage.getMetadata(key)
    if (!metadata) continue // raced with a concurrent delete — no longer relevant either way
    if (metadata.encryptionVersion === undefined) {
      unencrypted++
    } else if (metadata.encryptionVersion === activeVersion) {
      onActiveVersion++
    } else {
      versionsStillInUse.add(metadata.encryptionVersion as DataPolicyVersion)
    }
  }

  return {
    activeVersion,
    totalObjects,
    onActiveVersion,
    versionsStillInUse: [...versionsStillInUse],
    unencrypted,
    safeToRetireOldKeys: versionsStillInUse.size === 0 && unencrypted === 0,
  }
}

/** The real work behind `rotateEncryptionKeys()` — see that function's own doc for the concurrency
 * contract (checksum re-check before every write). */
export async function runRotate(
  storage: S3ObjectStorage,
  options: RotationOptionsWithoutWorker,
): Promise<RotationResult> {
  const activeVersion = requireActiveVersion(storage)

  let scanned = 0
  let migrated = 0
  let skipped = 0
  const failed: Array<{ key: string; error: string }> = []

  for await (const key of walkKeys(storage, options.prefix, options.maxKeysPerPage)) {
    scanned++
    try {
      const before = await storage.getMetadata(key)
      if (!before) {
        // Raced with a concurrent delete — nothing left to migrate.
        skipped++
        options.onProgress?.({ scanned, migrated, failed: failed.length })
        continue
      }
      if (before.encryptionVersion === activeVersion) {
        skipped++
        options.onProgress?.({ scanned, migrated, failed: failed.length })
        continue
      }

      if (options.dryRun) {
        migrated++ // "would migrate" — counted the same way a real run reports it
        options.onProgress?.({ scanned, migrated, failed: failed.length })
        continue
      }

      const found = await storage.get(key)
      if (!found) {
        skipped++
        options.onProgress?.({ scanned, migrated, failed: failed.length })
        continue
      }
      const plaintext = new Uint8Array(await new Response(found.stream).arrayBuffer())

      // Re-check immediately before writing — if the object changed since `getMetadata()` above,
      // someone else wrote real new content in between; skip rather than overwrite it with this
      // round's now-stale read. Checksum is computed over PLAINTEXT, so a mere re-encryption of
      // the SAME content (which is all this function itself ever does) never trips this check.
      const stillCurrent = await storage.getMetadata(key)
      if (!stillCurrent || stillCurrent.checksum !== before.checksum) {
        skipped++
        options.onProgress?.({ scanned, migrated, failed: failed.length })
        continue
      }

      await storage.put(key, plaintext, { contentType: found.object.contentType })
      migrated++
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.message : String(error) })
    }
    options.onProgress?.({ scanned, migrated, failed: failed.length })
  }

  return { scanned, migrated, skipped, failed }
}
