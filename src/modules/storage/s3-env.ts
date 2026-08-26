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
