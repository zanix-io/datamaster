/**
 * Generic object storage for the Zanix ecosystem — `SeaweedFSObjectStorage`, a byte-store connector
 * (put/get/delete/exists over an opaque key) backed by a SeaweedFS S3 gateway. Agnostic of what the
 * bytes represent or who's storing them — no assumptions about files, assets, or any particular
 * consumer. Registers the `'s3'` core connector slot; see `docs/STORAGE.md` for the full
 * architecture, configuration, and setup guide.
 *
 * @module zanixStorage
 */

export {
  SEAWEEDFS_ACCESS_KEY_ENV,
  SEAWEEDFS_BUCKET_ENV,
  SEAWEEDFS_ENCRYPT_ENV,
  SEAWEEDFS_ENCRYPT_VERSION_ENV,
  SEAWEEDFS_S3_ENDPOINT_ENV,
  SEAWEEDFS_SECRET_KEY_ENV,
  SeaweedFSObjectStorage,
} from './connector.ts'
export type {
  DataPolicyVersion,
  EncryptSettings,
  ObjectStorage,
  SeaweedFSConnectorOptions,
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
