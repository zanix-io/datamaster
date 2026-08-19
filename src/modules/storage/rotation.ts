/**
 * Key-rotation migration for `SeaweedFSObjectStorage` — mirrors the exact shape
 * `seedRotateProtectionKeys()`/`checkProtectionRotationStatus()` (`mongo/utils/seeders.ts`) already
 * establish for Mongo field-level protection: standalone functions taking the connector instance
 * (never methods baked into the class), one that reports status, one that actually migrates.
 *
 * Enabling `encrypt`/rotating `encrypt.version` only changes what NEW writes use — see
 * `connector.ts`'s own doc and `encryption.ts`'s — it never retroactively re-encrypts anything
 * already stored. These two functions are that missing, explicit step. Enumeration goes straight
 * through `SeaweedFSObjectStorage.listPage()` (a real, paginated `ListObjectsV2Command`) — no
 * dependency on `MongoFileRepository` or any other metadata registry, so this works standalone
 * for storage used entirely on its own.
 *
 * @module
 */

import type { DataPolicyVersion, SeaweedFSConnectorOptions } from './typings/general.ts'

import type { SeaweedFSObjectStorage } from './connector.ts'

import { dispatchWorkerTask } from '@zanix/server'
import { runCheck, runRotate } from './rotation-core.ts'
import {
  checkEncryptionRotationStatusInWorker,
  rotateEncryptionKeysInWorker,
  rotationWorkerMetaUrl,
} from './rotation-worker.ts'

/** Enumeration scope shared by {@link EncryptionRotationStatusOptions} and
 * {@link RotationOptionsBase} — how much of the bucket a scan/rotation walks. */
export interface EncryptionRotationStatusOptionsBase {
  /** Scope the run to keys starting with this prefix, instead of the whole bucket. */
  prefix?: string
  /** Overrides `listPage()`'s own per-page size (default 1000, S3's own maximum). */
  maxKeysPerPage?: number
}

/** Options for {@link checkEncryptionRotationStatus}. */
export type EncryptionRotationStatusOptions = EncryptionRotationStatusOptionsBase & {
  /**
   * Runs the scan inside a worker thread instead of the calling thread — `'one-time'` spins up a
   * throwaway worker for this call and closes it when done; `'persisted'` reuses the app's
   * registered `'worker'` core-provider pool (falling back to `'one-time'` automatically when
   * none is registered). Same two strategies, same fallback, as every other `useWorker` option in
   * this ecosystem (e.g. `@zanix/datamaster`'s own `elasticsearchLogSave`) — see
   * `@zanix/server`'s `dispatchWorkerTask` for the shared mechanics.
   *
   * Worth it mainly for a large bucket, where walking every key's metadata can run long enough to
   * be worth keeping off the calling thread. By default (omitted), the scan runs inline.
   */
  useWorker?: 'one-time' | 'persisted'
}

/** Return value of {@link checkEncryptionRotationStatus}. */
export interface EncryptionRotationStatus {
  /** The version `put()` currently encrypts NEW writes under. */
  activeVersion: DataPolicyVersion
  /** How many keys were walked in this scan. */
  totalObjects: number
  /** Already on `activeVersion` — nothing to do for these. */
  onActiveVersion: number
  /** Every OLDER version found on at least one object — exactly which `DATA_AES_KEY${suffix}`/
   * `DATA_RSA_KEY${suffix}` env vars are still depended on and can't be retired yet. */
  versionsStillInUse: DataPolicyVersion[]
  /** Objects with no `encryption-version` metadata at all — never encrypted (written before
   * encryption was turned on, or by an instance with `encrypt: false`). */
  unencrypted: number
  /** `true` once `versionsStillInUse` is empty and `unencrypted` is 0 — the data-driven answer to
   * "is it safe to remove the old key(s) from the environment now." */
  safeToRetireOldKeys: boolean
}

/**
 * Reports rotation status without changing anything — read-only, walks every key via
 * `listPage()`/`getMetadata()` (cheap `HeadObjectCommand`s, no bytes downloaded). Mirrors
 * `checkProtectionRotationStatus()`'s own role: run this BEFORE deciding an old key is safe to
 * remove from the environment, and again after `rotateEncryptionKeys()` to confirm it actually is.
 *
 * @throws If `storage` has encryption disabled — there's no active version to report against.
 */
export function checkEncryptionRotationStatus(
  storage: SeaweedFSObjectStorage,
  options: EncryptionRotationStatusOptions = {},
): Promise<EncryptionRotationStatus> {
  if (options.useWorker) {
    const { useWorker, ...rest } = options
    return runInWorker(
      checkEncryptionRotationStatusInWorker,
      storage.connectorOptions,
      useWorker,
      rest,
    )
  }
  return runCheck(storage, options)
}

/** {@link EncryptionRotationStatusOptionsBase} plus `dryRun` — the scope+mode shared by every
 * {@link EncryptionRotationOptions} variant. */
export interface RotationOptionsBase extends EncryptionRotationStatusOptionsBase {
  /** Reports what WOULD be migrated without writing anything — safe to run first on a large
   * bucket. */
  dryRun?: boolean
}

/** {@link EncryptionRotationOptions} minus `useWorker`/`onProgress` — what actually reaches
 * `rotation-core.ts`'s `runRotate`, on either the calling thread or a worker thread. Exported only
 * so `rotation-worker.ts` can reference the exact same shape. */
export type RotationOptionsWithoutWorker = RotationOptionsBase & {
  /** Called after each key is processed (migrated, skipped, or failed) — for a caller that wants
   * live feedback on a long-running rotation. Not supported together with `useWorker`: a callback
   * isn't structured-cloneable, so it can never reach a worker thread — see `useWorker`'s own doc. */
  onProgress?: (info: { scanned: number; migrated: number; failed: number }) => void
}

/** Options for {@link rotateEncryptionKeys}. `onProgress` and `useWorker` are mutually exclusive —
 * pick one: run inline with live progress, or run in a worker and just await the final result. */
export type EncryptionRotationOptions =
  | (RotationOptionsWithoutWorker & { useWorker?: never })
  | (RotationOptionsBase & {
    onProgress?: never
    /** Same two strategies/fallback as {@link EncryptionRotationStatusOptions.useWorker} — see
     * its doc for the full explanation. Worth it for a large bucket's worth of re-encrypt work,
     * which is real CPU + I/O, not just a metadata scan. */
    useWorker: 'one-time' | 'persisted'
  })

/** Return value of {@link rotateEncryptionKeys}. */
export interface RotationResult {
  /** How many keys were walked in this run. */
  scanned: number
  /** Actually (or, under `dryRun`, would have been) re-encrypted under the active version. */
  migrated: number
  /** Already on the active version (no I/O beyond the metadata check), OR skipped this round
   * because it changed concurrently — see this module's own top-level doc on why that's a skip,
   * not an overwrite. */
  skipped: number
  /** Never aborts the whole run — one bad key's real error is collected here, and the walk
   * continues, mirroring `seedRotateProtectionKeys()`'s own per-document resilience. */
  failed: Array<{ key: string; error: string }>
}

/**
 * Re-encrypts every object still on an OLD version (or never encrypted at all) under `storage`'s
 * own currently-active version — same key, same location, only the ciphertext/metadata changes.
 * Safe to re-run: already-migrated objects are skipped cheaply (a metadata check, no decrypt/
 * re-encrypt round trip), so this is meant to be invoked repeatedly (e.g. after fixing a batch of
 * `failed` entries, or after a `checkEncryptionRotationStatus()` run still shows old versions in
 * use) rather than treated as a single all-or-nothing operation.
 *
 * Concurrency: an object CREATED while this runs is never a problem — new writes already land on
 * the active version. An object OVERWRITTEN by the application between this function's own `get()`
 * (which reads and decrypts it) and `put()` (which would re-encrypt and overwrite it) is a real
 * race — handled by re-checking the object's own checksum immediately before writing; if it
 * changed, this SKIPS that key for this round rather than clobbering the concurrent write. The
 * next run picks it up cleanly (it's now on the active version already, or still pending — either
 * way, correct).
 *
 * @throws If `storage` has encryption disabled.
 */
export function rotateEncryptionKeys(
  storage: SeaweedFSObjectStorage,
  options: EncryptionRotationOptions = {},
): Promise<RotationResult> {
  if (options.useWorker) {
    const { useWorker, onProgress: _onProgress, ...rest } = options
    return runInWorker(rotateEncryptionKeysInWorker, storage.connectorOptions, useWorker, rest)
  }
  return runRotate(storage, options)
}

/**
 * Shared `dispatchWorkerTask` plumbing for both functions above. Wrapped in a `new Promise` around
 * `dispatchWorkerTask`'s own `callback` — the same pattern `observability/log-adapter.ts`'s
 * `flushViaWorker` already uses to turn a fire-and-forget `invoke()` into an awaitable result.
 */
function runInWorker<O, R>(
  fn: (connectorOptions: SeaweedFSConnectorOptions, options: O) => Promise<R>,
  connectorOptions: SeaweedFSConnectorOptions,
  mode: 'one-time' | 'persisted',
  options: O,
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    dispatchWorkerTask(fn, {
      mode,
      metaUrl: rotationWorkerMetaUrl,
      verbose: false,
      callback: ({ response, error }) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)))
        else resolve(response as R)
      },
    })(connectorOptions, options)
  })
}
