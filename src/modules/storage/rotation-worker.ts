/**
 * Worker-thread entry points for `rotation.ts`'s `useWorker` option — reconstructs a
 * `SeaweedFSObjectStorage` from plain, structured-cloneable `connectorOptions` (a live instance,
 * with its internal `S3Client`, can't cross the `postMessage` boundary) and runs the same
 * `rotation-core.ts` logic the non-worker path uses. Mirrors `observability/worker-flush.ts`'s
 * `flushBulkInWorker` exactly — same reconstruct-inside-the-worker shape, same reason for it.
 *
 * @module
 */

import type { SeaweedFSConnectorOptions } from './typings/general.ts'
import type {
  EncryptionRotationStatus,
  EncryptionRotationStatusOptions,
  RotationOptionsWithoutWorker,
  RotationResult,
} from './rotation.ts'

import { SeaweedFSObjectStorage } from './connector.ts'
import { runCheck, runRotate } from './rotation-core.ts'

/**
 * This file's own URL, passed as `metaUrl` to `dispatchWorkerTask` so the worker thread can
 * dynamically re-import this exact module and look up `checkEncryptionRotationStatusInWorker`/
 * `rotateEncryptionKeysInWorker` by name.
 */
export const rotationWorkerMetaUrl = import.meta.url

/** Runs `checkEncryptionRotationStatus()`'s real work inside a worker thread — used only when
 * `useWorker` is set. `onProgress` isn't accepted here: a callback isn't structured-cloneable, so
 * it can never reach the worker in the first place (see `rotation.ts`'s own option typing). */
export function checkEncryptionRotationStatusInWorker(
  connectorOptions: SeaweedFSConnectorOptions,
  options: EncryptionRotationStatusOptions,
): Promise<EncryptionRotationStatus> {
  return runCheck(new SeaweedFSObjectStorage(connectorOptions), options)
}

/** Runs `rotateEncryptionKeys()`'s real work inside a worker thread — used only when `useWorker`
 * is set. Same `onProgress` caveat as above. */
export function rotateEncryptionKeysInWorker(
  connectorOptions: SeaweedFSConnectorOptions,
  options: RotationOptionsWithoutWorker,
): Promise<RotationResult> {
  return runRotate(new SeaweedFSObjectStorage(connectorOptions), options)
}
