import type {
  DataPolicyVersion,
  ObjectStorage,
  S3ConnectorOptions,
  StorageEncryptSettings,
  StoredObject,
} from './typings/general.ts'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { ZanixConnector } from '@zanix/server'
import { checksumOf, readAllBytes } from './bytes.ts'
import { decryptBytes, encryptBytes, ENCRYPTION_VERSION_METADATA } from './encryption.ts'

/** Env var for the S3-compatible endpoint, e.g. `http://localhost:8333`. */
export const S3_ENDPOINT_ENV = 'S3_ENDPOINT'
/** Env var for the SigV4 access key configured on the S3-compatible gateway. */
export const S3_ACCESS_KEY_ENV = 'S3_ACCESS_KEY'
/** Env var for the SigV4 secret key configured on the S3-compatible gateway. */
export const S3_SECRET_KEY_ENV = 'S3_SECRET_KEY'
/** Env var for the bucket every object is stored under. */
export const S3_BUCKET_ENV = 'S3_BUCKET'
/** Env var for the AWS region to sign requests for — see {@link DUMMY_REGION}'s own doc for why
 * this matters for real AWS S3 specifically, and is a no-op for most self-hosted gateways. */
export const S3_REGION_ENV = 'S3_REGION'
/** Env var for `encrypt.type` (`'symmetric'`/`'asymmetric'`) — the only way to enable encryption
 * for the connector instance the standard `@Connector`/DI boot path constructs (it never receives
 * custom constructor arguments — see `../core.ts`), same reasoning every other option below already
 * has an env var fallback for. */
export const S3_ENCRYPT_ENV = 'S3_ENCRYPT'
/** Env var for `encrypt.version` — the key-rotation version new writes use. Ignored unless
 * `S3_ENCRYPT`/`encrypt.type` is also set. */
export const S3_ENCRYPT_VERSION_ENV = 'S3_ENCRYPT_VERSION'

const DEFAULT_ENDPOINT = 'http://localhost:8333'
const DEFAULT_BUCKET = 'zanix-objects'
/**
 * Default region signed into every request when neither `options.region` nor `S3_REGION` is set.
 * Most self-hosted S3-compatible gateways (SeaweedFS included) don't validate the region at all —
 * any value works, so this exists as a recognizable dummy rather than an arbitrary string, since
 * `@aws-sdk/client-s3` requires a non-empty one either way.
 *
 * **Real boundary of the "genuinely generic S3 client" claim, confirmed empirically** (see
 * `src/@tests/unit/storage/s3-object-storage-generic-backend.test.ts`): unlike `endpoint`/
 * `accessKeyId`/`secretAccessKey`/`bucket`, this was NOT overridable at all until `region` was
 * added to {@link S3ConnectorOptions} — every client silently signed as `us-east-1` regardless of
 * the configured endpoint. Harmless against a gateway that ignores region, but SigV4 genuinely
 * fails signature validation against a real AWS S3 bucket outside `us-east-1` without the real
 * region supplied explicitly (`options.region`/`S3_REGION`).
 */
const DUMMY_REGION = 'us-east-1'
/** Custom metadata key an object's own checksum (this package's sha256-hex, computed over the
 * plaintext bytes) is stored under — read back on `get()`/`exists()`, never recomputed. */
const CHECKSUM_METADATA = 'checksum'

const resolveEndpoint = (endpoint?: string): string =>
  endpoint || Deno.env.get(S3_ENDPOINT_ENV) || DEFAULT_ENDPOINT

const resolveBucket = (bucket?: string): string =>
  bucket || Deno.env.get(S3_BUCKET_ENV) || DEFAULT_BUCKET

const resolveRegion = (region?: string): string =>
  region || Deno.env.get(S3_REGION_ENV) || DUMMY_REGION

const resolveCredentials = (
  accessKeyId?: string,
  secretAccessKey?: string,
): { accessKeyId: string; secretAccessKey: string } => ({
  accessKeyId: accessKeyId || Deno.env.get(S3_ACCESS_KEY_ENV) || '',
  secretAccessKey: secretAccessKey || Deno.env.get(S3_SECRET_KEY_ENV) || '',
})

/** An explicit `encrypt` option always wins (including `undefined`, an explicit "off" — same
 * precedence rule every other option in this file follows: presence of the OPTION KEY, not just a
 * truthy value, decides whether the env var is even consulted... except here there's no way to
 * distinguish "omitted" from "explicitly undefined" once destructured, so — matching how a
 * consumer would actually call this — an explicit option object (even `{}`) always wins over the
 * env var). `S3_ENCRYPT` must be exactly `'symmetric'`/`'asymmetric'` — anything else
 * (including unset) leaves encryption off. */
const resolveEncrypt = (
  explicit: StorageEncryptSettings | false | undefined,
): StorageEncryptSettings | undefined => {
  // `false` is a real, distinct value from `undefined` — the only way to say "encryption is OFF
  // for this instance, ignore S3_ENCRYPT" (real scenario: an env var enables it
  // process-wide, but one specific caller — e.g. a diagnostic/comparison connector in a test —
  // deliberately needs an unencrypted view). Omitting `encrypt` entirely (`undefined`) is NOT the
  // same thing — it means "no opinion," which is exactly when the env var SHOULD apply.
  if (explicit === false) return undefined
  if (explicit) return explicit
  const type = Deno.env.get(S3_ENCRYPT_ENV)
  if (type !== 'symmetric' && type !== 'asymmetric') return undefined
  const version = Deno.env.get(S3_ENCRYPT_VERSION_ENV) as DataPolicyVersion | undefined
  return { type, version }
}

/**
 * A generic `ObjectStorage` implementation backed by any S3-compatible object store, via a real
 * `@aws-sdk/client-s3` `S3Client` (`forcePathStyle: true` — many self-hosted S3-compatible gateways,
 * e.g. SeaweedFS, don't support virtual-hosted-style addressing). Stores arbitrary bytes under an
 * opaque, caller-supplied key —
 * this class has no knowledge of what the bytes represent or who's storing them; keys are never
 * transformed, only passed straight through as the S3 `Key`.
 *
 * Extends `ZanixConnector` directly rather than `RestClient` — `RestClient#http()` coerces every
 * non-JSON response through `.text()`, which can't carry binary object bytes. `isHealthy()` is a
 * real async `HeadBucketCommand` probe, unlike `ZanixElasticsearchConnector`'s (which stays
 * synchronous only because it inherits `RestClient`'s signature).
 *
 * `NoSuchKey`/`NotFound` (a missing object) are mapped to `ObjectStorage`'s own "doesn't exist"
 * contract (`undefined`/`false`) — every other failure (connectivity, auth, a misconfigured bucket)
 * propagates unmapped, matching this package's existing convention of not wrapping infra errors in
 * a bespoke type (see `docs/storage.md`).
 *
 * @extends ZanixConnector
 */
export class S3ObjectStorage extends ZanixConnector implements ObjectStorage {
  #client: S3Client
  #bucket: string
  #endpoint: string
  #accessKeyId: string
  #secretAccessKey: string
  /** The RESOLVED decision — never `false` (that's only a valid INPUT to {@link resolveEncrypt},
   * meaning "off"; the resolved field is either real settings or genuinely absent). */
  #encrypt: StorageEncryptSettings | undefined

  constructor(options: S3ConnectorOptions = {}) {
    const {
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      region,
      encrypt,
      ...connectorOptions
    } = options
    super(connectorOptions)
    this.#bucket = resolveBucket(bucket)
    this.#encrypt = resolveEncrypt(encrypt)
    this.#endpoint = resolveEndpoint(endpoint)
    const credentials = resolveCredentials(accessKeyId, secretAccessKey)
    this.#accessKeyId = credentials.accessKeyId
    this.#secretAccessKey = credentials.secretAccessKey
    this.#client = new S3Client({
      endpoint: this.#endpoint,
      // Real, overridable region — see `DUMMY_REGION`'s own doc for why this matters for real AWS
      // S3 specifically. Defaults to the harmless dummy for gateways that don't validate it.
      region: resolveRegion(region),
      forcePathStyle: true,
      credentials,
    })
  }

  /** This instance's own resolved encryption configuration (`undefined` when encryption is off) —
   * read by `rotation.ts` to know which version is "active" (the one `put()` already encrypts new
   * writes under) without needing its own separate copy of that decision. */
  public get encryptSettings(): StorageEncryptSettings | undefined {
    return this.#encrypt
  }

  /**
   * This instance's own fully-resolved, structured-cloneable constructor options — same shape
   * `S3ConnectorOptions` accepts, but with every value already resolved from either the
   * explicit constructor argument or its env-var fallback (no more `undefined` "check the env var"
   * gaps left for the receiving end to re-resolve differently).
   *
   * Exists for exactly one real consumer: `rotation.ts`'s `useWorker` option. A live
   * `S3ObjectStorage` instance — its `#client` is a real `S3Client` holding open
   * connections/timers — can't cross a `postMessage` boundary into a worker thread. This getter is
   * what a worker-side task uses to call `new S3ObjectStorage(storage.connectorOptions)` and
   * get back an equivalent instance, the same reconstruct-inside-the-worker approach
   * `observability/worker-flush.ts`'s `flushBulkInWorker` already uses via `getConnector(...)`.
   */
  public get connectorOptions(): S3ConnectorOptions {
    return {
      endpoint: this.#endpoint,
      bucket: this.#bucket,
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      encrypt: this.#encrypt ?? false,
    }
  }

  /** No connection to establish up front — `S3Client` itself is lazy/stateless; see `isHealthy()`
   * for the real reachability probe. */
  protected initialize(): void {}

  protected close(): unknown {
    return this.#client.destroy()
  }

  /** Pings the bucket via `HeadBucketCommand` — a real, async network check (unlike `RestClient`
   * subclasses, this connector's `isHealthy()` isn't constrained to a synchronous signature). */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }))
      return true
    } catch {
      return false
    }
  }

  public async put(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string },
  ): Promise<StoredObject> {
    const plaintext = await readAllBytes(data)
    const checksum = await checksumOf(plaintext)

    let body: Uint8Array = plaintext
    const metadata: Record<string, string> = { [CHECKSUM_METADATA]: checksum }

    if (this.#encrypt) {
      const encrypted = await encryptBytes(plaintext, this.#encrypt)
      body = encrypted.ciphertext
      Object.assign(metadata, encrypted.metadata)
    }

    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: meta.contentType,
        Metadata: metadata,
      }),
    )

    return { key, contentType: meta.contentType, size: plaintext.byteLength, checksum }
  }

  public async get(
    key: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; object: StoredObject } | undefined> {
    try {
      const result = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      const body = await result.Body?.transformToByteArray()
      if (!body) return undefined

      const metadata = result.Metadata ?? {}
      // `this.#encrypt` being set only means THIS instance is configured to encrypt/decrypt — it
      // says nothing about whether THIS PARTICULAR object was ever actually encrypted (e.g. it was
      // written before encryption was turned on, or by an instance with `encrypt: false`). Only the
      // object's OWN recorded `encryption-version` metadata means "this is real ciphertext" —
      // attempting to decrypt genuinely-plaintext bytes would corrupt them, not recover them.
      const encrypt = this.#encrypt
      const isEncrypted = Boolean(encrypt) && metadata[ENCRYPTION_VERSION_METADATA] !== undefined
      const plaintext = isEncrypted && encrypt ? await decryptBytes(body, encrypt, metadata) : body
      const checksum = metadata[CHECKSUM_METADATA] ?? await checksumOf(plaintext)
      const contentType = result.ContentType ?? 'application/octet-stream'

      return {
        // Re-wrapped for the same `ArrayBufferLike` vs `ArrayBuffer` structural reason as
        // `checksumOf` above — `Response`'s `BodyInit` doesn't structurally accept the wider type.
        stream: new Response(new Uint8Array(plaintext)).body as ReadableStream<Uint8Array>,
        object: { key, contentType, size: plaintext.byteLength, checksum },
      }
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  public async delete(key: string): Promise<void> {
    // S3-compatible `DeleteObject` is already idempotent (no error for a missing key) — matches
    // this port's own "deleting something already gone is not an error" contract with no extra
    // handling needed.
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }))
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }))
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  /**
   * One real, paginated page of keys in this bucket — S3-specific, deliberately NOT part
   * of the generic `ObjectStorage` port (that stays minimal; see `docs/storage.md`). Exists for
   * `rotation.ts`'s own enumeration, and for any other caller that genuinely needs to walk a
   * bucket's contents (something the generic put/get/delete/exists contract never promises).
   *
   * `continuationToken` from a previous call's own `nextContinuationToken` continues the listing;
   * omit it to start from the beginning. `maxKeys` defaults to 1000, S3's own per-page maximum.
   */
  public async listPage(
    options: { prefix?: string; continuationToken?: string; maxKeys?: number } = {},
  ): Promise<{ keys: string[]; nextContinuationToken?: string }> {
    const result = await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: options.prefix,
        ContinuationToken: options.continuationToken,
        MaxKeys: options.maxKeys ?? 1000,
      }),
    )
    return {
      keys: (result.Contents ?? []).map((entry) => entry.Key).filter((key): key is string =>
        Boolean(key)
      ),
      nextContinuationToken: result.IsTruncated ? result.NextContinuationToken : undefined,
    }
  }

  /**
   * A single key's own stored metadata — `checksum` and, if the object is actually encrypted,
   * `encryptionVersion` — via a cheap `HeadObjectCommand`, no bytes downloaded. `undefined` for a
   * missing key, same "doesn't exist" contract every other method here follows.
   */
  public async getMetadata(
    key: string,
  ): Promise<{ checksum: string; encryptionVersion?: string } | undefined> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      const metadata = result.Metadata ?? {}
      return {
        checksum: metadata[CHECKSUM_METADATA] ?? '',
        encryptionVersion: metadata[ENCRYPTION_VERSION_METADATA],
      }
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }
}

/** Recognizes a missing-object error from the S3 SDK — `NoSuchKey` (GetObject) or `NotFound`
 * (HeadObject/HeadBucket) — the two real shapes an S3-compatible gateway returns for a missing
 * key. */
function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  return name === 'NoSuchKey' || name === 'NotFound'
}
