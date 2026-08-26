/**
 * Generic object storage for the Zanix ecosystem — `S3ObjectStorage`, a byte-store connector
 * (put/get/delete/exists over an opaque key) backed by an S3-compatible gateway. Agnostic of what the
 * bytes represent or who's storing them — no assumptions about files, assets, or any particular
 * consumer. Registers the `'s3'` core connector slot; see `docs/storage.md` for the full
 * architecture, configuration, and setup guide.
 *
 * @module zanixStorage
 */

export {
  S3_ACCESS_KEY_ENV,
  S3_BUCKET_ENV,
  S3_ENCRYPT_ENV,
  S3_ENCRYPT_VERSION_ENV,
  S3_ENDPOINT_ENV,
  S3_SECRET_KEY_ENV,
} from './s3-env.ts'

export { S3ObjectStorage } from './connector.ts'

export type {
  DataPolicyVersion,
  EncryptSettings,
  ObjectStorage,
  S3ConnectorOptions,
  StorageEncryptSettings,
  StoredObject,
} from './typings/general.ts'
export { checkEncryptionRotationStatus, rotateEncryptionKeys } from './rotation.ts'
export type {
  EncryptionRotationOptions,
  EncryptionRotationStatus,
  EncryptionRotationStatusOptions,
  EncryptionRotationStatusOptionsBase,
  RotationOptionsBase,
  RotationOptionsWithoutWorker,
  RotationResult,
} from './rotation.ts'
export { createLocalFilesystemObjectStorage } from './local-filesystem-object-storage.ts'
export { createFallbackObjectStorage } from './fallback-object-storage.ts'
export { ensureLocalObjectsSynced, resetLocalObjectsSyncState } from './sync-local-objects.ts'
