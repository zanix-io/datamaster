import type { ConnectorOptions } from '@zanix/server'
import type { DataPolicyVersion, EncryptSettings } from 'typings/protection.ts'

export type { DataPolicyVersion, EncryptSettings }

/**
 * {@link EncryptSettings} plus an optional key VERSION — a local extension, not a change to the
 * shared `EncryptSettings` type itself (also used by `dataProtectionGetter`'s field-level
 * encryption, which has its own, Mongoose-schema-shaped versioning story). Mirrors
 * `utils/protection.ts`'s own versioned-key convention exactly: `DATA_AES_KEY_V1`,
 * `DATA_RSA_PUB_V1`/`DATA_RSA_KEY_V1`, etc. — same env vars, same suffix rule, no parallel scheme.
 * Rotating `version` only changes what NEW objects (`put()`) are encrypted under; an object's own
 * version, once written, is carried in its storage metadata and always used for its own decryption
 * — see `encryption.ts`'s own doc for why that matters.
 */
export type StorageEncryptSettings = EncryptSettings & { version?: DataPolicyVersion }

/** One stored object's own real properties, as reported back by `put`/`get` — never the bytes
 * themselves (a separate stream, see `ObjectStorage.get`). */
export interface StoredObject {
  key: string
  contentType: string
  size: number
  checksum: string
}

/**
 * A generic byte store, keyed by an opaque string — put/get/delete/exists over arbitrary content,
 * with no knowledge of what the bytes represent. `S3ObjectStorage` (`connector.ts`) is this
 * package's own implementation; nothing else in this package (or in `@zanix/datamaster` generally)
 * assumes a specific consumer, domain, or file kind.
 */
export interface ObjectStorage {
  /** Persists `data` under `key`, returning the real, stored object's own properties (size/
   * checksum as actually written — never assumed from the caller's own claim). */
  put(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string },
  ): Promise<StoredObject>
  /** `undefined` when `key` doesn't exist — never throws for a missing object. */
  get(
    key: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; object: StoredObject } | undefined>
  /** A no-op when `key` doesn't exist — deleting something already gone is not an error. */
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

/**
 * Connection options for {@link S3ObjectStorage}. Every field falls back to an environment
 * variable when omitted — see `connector.ts`'s `resolveEndpoint`/`resolveCredentials`/
 * `resolveBucket`/`resolveRegion` for the exact precedence (explicit option always wins).
 */
export type S3ConnectorOptions = ConnectorOptions & {
  /** S3 gateway endpoint, e.g. `http://localhost:8333`. Falls back to `S3_ENDPOINT`. */
  endpoint?: string
  /** SigV4 access key. Falls back to `S3_ACCESS_KEY`. */
  accessKeyId?: string
  /** SigV4 secret key. Falls back to `S3_SECRET_KEY`. */
  secretAccessKey?: string
  /** Bucket every object is stored under. Falls back to `S3_BUCKET`. */
  bucket?: string
  /**
   * AWS region every request is SigV4-signed for. Falls back to `S3_REGION`, then a harmless
   * dummy region most self-hosted S3-compatible gateways don't validate anyway. **Required for a
   * real, non-`us-east-1` AWS S3 bucket specifically** — without it, signature validation fails
   * against real AWS S3 (see `connector.ts`'s own `DUMMY_REGION` doc for the full reasoning; this
   * option is what makes that gap fixable rather than a hard limitation).
   */
  region?: string
  /**
   * Encrypts object bytes at rest before they leave the process — off by default. `'symmetric'`
   * encrypts the bytes directly with `DATA_AES_KEY`; `'asymmetric'` wraps a random per-object AES
   * key with `DATA_RSA_PUB`/`DATA_RSA_KEY` (RSA can't encrypt arbitrary-size payloads directly, so
   * this is real envelope encryption, not a whole-file RSA op) — see `encryption.ts`'s own doc for
   * the full rationale, including why this deliberately does NOT reuse `utils/protection.ts`'s
   * fail-open `encrypt`/`decrypt` wrappers. `version` supports key rotation — see
   * {@link StorageEncryptSettings}'s own doc.
   *
   * Omitted (`undefined`) falls back to `S3_ENCRYPT`/`S3_ENCRYPT_VERSION` — the only
   * way to enable encryption on the connector instance the standard `@Connector`/DI boot path
   * constructs, since that path never receives custom constructor arguments. Passing the literal
   * `false` is different from omitting this option: it explicitly forces encryption OFF for this
   * one instance, ignoring the env var — for a caller that genuinely needs an unencrypted view even
   * though the env var enables it process-wide (e.g. a diagnostic/comparison connector).
   */
  encrypt?: StorageEncryptSettings | false
}
