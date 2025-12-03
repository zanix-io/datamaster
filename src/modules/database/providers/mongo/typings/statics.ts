import type { Model, ReadContext, ReadDocumentsOptions } from './commons.ts'
import type { generateHash, validateHash } from '@zanix/helpers'
import type { MaskingBaseOptions } from '@zanix/types'
import type { ClientSession, Document, Schema } from 'mongoose'
import type { DataObject } from 'database/typings/models.ts'
import type { AdaptedModel, AdaptedModelBySchema } from './models.ts'
import type {
  DataAccessConfig,
  DataPolicyVersion,
  DataProtection,
  EncryptSettings,
  MaskingSettings,
} from 'typings/protection.ts'

/** Upsert type options */
export type UpsertTypeOptions = { useDataPolicies?: boolean; type?: 'update' | 'insert' }

/**
 * Defines the shape of **static methods** attached to a schema (e.g., a Mongoose schema).
 *
 * Static methods are available **directly on the model** rather than on individual documents.
 * Use this type to ensure proper typing and IntelliSense when extending `schema.statics`.
 */
export type SchemaStatics = {
  /** Data Policies Methods */
  _getDataProtection: () => Record<string, DataProtection>
  _getDataAccess: () => Record<string, DataAccessConfig>
  _getDataAccessPaths: () => string[]
  _getDataProtectionPaths: () => string[]
  _hasDataProtection: () => boolean
  _hasDataAccess: () => boolean
  /**
   * Encrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
   *
   * This function automatically selects the encryption method based on the key type provided.
   *
   * @param {T} message - The message or array of messages to be encrypted.
   *   Can be a single string or an array of strings. Each message will be encrypted separately.
   *
   * @param {EncryptSettings} settings - The encryption settings to be used for the encryption process.
   *   For example, the type of encryption (`symmetric` or `asymmetric`), as well as any additional
   *   encryption-related configurations.
   *   - If the type is `symmetric`, the system will look for the environment variable `DATA_AES_KEY`.
   *   - If the type is `asymmetric`, the system will look for the environment variable `DATA_RSA_PUB`.
   *
   * @param {DataPolicyVersion} [version] - The version of the encryption settings to be applied.
   *   This corresponds to specific environment variables that define keys for different versions of encryption:
   *   - For symmetric encryption, `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
   *   - For asymmetric encryption, `DATA_RSA_PUB_V1`, `DATA_RSA_PUB_V2`, etc.
   *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
   *     `DATA_RSA_PRIVATE_KEY` as primary, and falls back to `DATA_RSA_PRIVATE_KEY`.
   *
   * @returns {Promise<T>} A promise that resolves to the encrypted message(s).
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  encrypt: <T extends string | string[]>(
    message: T,
    settings?: EncryptSettings,
    version?: DataPolicyVersion,
  ) => Promise<T>
  /**
   * Decrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
   *
   * @param {T} encryptedMessage - The encrypted message or array of encrypted messages to decrypt.
   *   Can be a single string or an array of strings. Each encrypted message will be decrypted separately.
   *
   * @param {EncryptSettings} settings - The decryption settings that match the settings used during encryption.
   *   This includes the type of encryption (e.g., `symmetric` or `asymmetric`), as well as any other relevant settings.
   *   - If the type was `symmetric` during encryption, ensure the same key (e.g., `DATA_AES_KEY`) is available.
   *   - If the type was `asymmetric` during encryption, ensure the corresponding private key (e.g., `DATA_RSA_PRIVATE_KEY`) is available.
   *
   * @param {DataPolicyVersion} [version] - The version of the encryption settings used during encryption.
   *   The environment variable keys for decryption must correspond to the same version used for encryption:
   *   - For symmetric encryption, use `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
   *   - For asymmetric encryption, use `DATA_RSA_PRIVATE_KEY_V1`, `DATA_RSA_PRIVATE_KEY_V2`, etc.
   *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
   *     `DATA_RSA_PRIVATE_KEY` as primary, and falls back to `DATA_RSA_PRIVATE_KEY`.
   *
   * @returns {Promise<T>} A promise that resolves to the decrypted message(s).
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  decrypt: <T extends string | string[]>(
    encryptedMessage: T,
    settings?: EncryptSettings,
    version?: DataPolicyVersion,
  ) => Promise<T>

  /**
   * Hash generation. Unidirectional encryption.
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  hash: typeof generateHash
  /**
   * Hash validation. Unidirectional encryption.
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  validateHash: typeof validateHash
  /**
   * Masks the provided message(s) using a secret key for obfuscation or reversible masking.
   *
   * @param {string | string[]} message - The message or array of messages to mask.
   *   Can be a single string or an array of strings. Each message will be masked individually.
   *
   * @param {MaskingSettings} settings - The masking configuration to be applied.
   *   Defines how masking should be performed (e.g., algorithm type, mask format, or additional options).
   *   - This method requires a secret key to perform masking.
   *   - It first checks for the environment variable `DATA_SECRET_KEY`.
   *   - If `DATA_SECRET_KEY` is not defined, it falls back to `DATA_AES_KEY`.
   *
   * @param {DataPolicyVersion} [version] - (Optional) The version of the masking policy.
   *   If provided, versioned environment variables will be used instead:
   *   - For example: `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, etc.
   *   - If those are not found, it falls back to `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
   *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
   *     `DATA_SECRET_KEY` as primary, and falls back to `DATA_AES_KEY`.
   *
   * @returns {string | string[]} A promise that resolves to the masked message(s).
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  mask: <T extends string | string[]>(
    input: T,
    settings?: MaskingSettings,
    version?: DataPolicyVersion,
  ) => T
  /**
   * Unmasks (reverses) the provided masked message(s) using the same secret key and configuration
   * that were used during masking.
   *
   * @param {string | string[]} maskedMessage - The masked message or array of masked messages to unmask.
   *   Can be a single string or an array of strings. Each masked value will be unmasked individually.
   *
   * @param {MaskingSettings} settings - The masking configuration that matches the one used during masking.
   *   This must correspond to the same algorithm, format, and options applied during the mask operation.
   *   - The method uses a secret key to unmask data.
   *   - It first checks for the environment variable `DATA_SECRET_KEY`.
   *   - If `DATA_SECRET_KEY` is not defined, it falls back to `DATA_AES_KEY`.
   *
   * @param {DataPolicyVersion} [version] - (Optional) The version of the masking policy used.
   *   If provided, versioned environment variables will be referenced:
   *   - For example: `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, etc.
   *   - If those are not found, it falls back to `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, etc.
   *   - If no version is provided (defaults to **v0**), it uses the non-suffixed variables:
   *     `DATA_SECRET_KEY` as primary, and falls back to `DATA_AES_KEY`.
   *
   * @returns {string | string[]} A promise that resolves to the original unmasked message(s).
   *
   * @see {@link https://jsr.io/@zanix/utils} to get information of the original function.
   */
  unmask: <T extends string | string[]>(
    input: T,
    settings?: MaskingBaseOptions,
    version?: DataPolicyVersion,
  ) => T

  /**
   * Initiates a transaction on the schema with commit and abort capabilities.
   *
   * This function checks if the underlying MongoDB instance supports transactions
   * (requires a replica set or a sharded cluster). If transactions are not supported,
   * a warning is logged.
   *
   * @function startTransaction
   * @returns {Promise<ClientSession>}
   * The MongoDB ClientSession associated with the transaction.
   *
   * @example
   * ```ts
   * const { session, commit, abort } = await MyModel.startTransaction();
   * try {
   *   // Perform operations within the transaction
   *   MyModel.create({ name: 'example' }, { session }) // or new MyModel({ name: 'example' }).save({ session })
   *   await commit();
   * } catch (error) {
   *   await abort();
   *   console.error('Transaction failed:', error);
   * }
   * ```
   */
  startTransaction: (this: Model) => Promise<
    {
      /**
       * The active `ClientSession` instance created by Mongoose.
       *
       * Pass this session to all Mongoose operations you want to run
       * within the same transaction context.
       */
      session: ClientSession
      /**
       * Commits the currently active transaction in this session,
       * make validations and then finalizes (closes) the session.
       * @returns {Promise<boolean>} to indicate whether the process was successful
       */
      commit: () => Promise<boolean>
      /**
       * Aborts the currently active transaction in this session,
       * make validations and then finalizes (closes) the session.
       * @returns {Promise<boolean>} to indicate whether the process was successful
       */
      abort: () => Promise<boolean>
    }
  >
  /**
   * Returns whether the current MongoDB connection is part of a replica set based on URI connection protocol.
   *
   * @returns {boolean} `true` if connected to a replica set or sharded cluster, otherwise `false`.
   */
  isReplicaSet: () => boolean | undefined

  /**
   * Finds a document by its `_id` and undates or creates it if it does not exist.
   *
   * Performs an `updateOne`
   *
   * @this {AdaptedModel} The Mongoose model.
   * @param {DataObject} data - The data to insert if the document does not exist.
   * @param {UpsertTypeOptions} options - The upsert type options
   * @param {UpsertTypeOptions['useDataPolicies']} options.useDataPolicies - Determines whether data policies should be applied to the seeded data.
   * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `false`.
   * @param {UpsertTypeOptions['type']} options.type - Determines the type of the operation. (e.g. insert, update). Defaults to `insert`
   *
   * @returns {Promise<void>}
   */
  upsertById: (
    this: AdaptedModel,
    data: DataObject,
    options?: UpsertTypeOptions,
  ) => Promise<void>
  /**
   * Finds multiple documents by their `_id` and creates them if they do not exist.
   *
   * This method performs a `bulkWrite` with `upsert: true` for each object,
   * ensuring each document exists without modifying existing ones.
   *
   * @this {AdaptedModel} The Mongoose model.
   * @param {DataObject[]} data - Array of documents to insert if missing.
   * @param {UpsertTypeOptions} options - The upsert type options
   * @param {UpsertTypeOptions['useDataPolicies']} options.useDataPolicies - Determines whether data policies should be applied to the seeded data.
   * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `false`.
   * @param {UpsertTypeOptions['type']} options.type - Determines the type of the operation. (e.g. insert, update). Defaults to `insert`
   *
   * @returns {Promise<void>} A promise that resolves to the bulk write result.
   *
   * @example
   * await User.upsertManyById([
   *   { id: 'abc123', name: 'Alice' },
   *   { id: 'def456', name: 'Bob' }
   * ]);
   */
  upsertManyById: (
    this: AdaptedModel,
    data: DataObject[],
    options?: UpsertTypeOptions,
  ) => Promise<void>
  /**
   * Reads all documents into memory using `.find()`.
   * Fast, but memory-heavy.
   *
   * Defaults:
   *  - `useLean = true`        : Returns plain JavaScript objects instead of Mongoose documents
   *  - `limit = 0`             : No limit, reads all documents
   *  - `filter = {}`           : No filter, reads all documents
   */
  readFind<T extends Document, S extends Schema>(
    this: AdaptedModel<T> | AdaptedModelBySchema<S>,
    options: ReadContext<T>,
  ): Promise<void>
  /**
   * Streams documents one by one using a Mongoose cursor.
   * Most memory-efficient option.
   *
   * Defaults:
   *  - `useLean = true`        : Returns plain JavaScript objects instead of Mongoose documents
   *  - `limit = 0`             : No limit, reads all documents
   *  - `filter = {}`           : No filter, reads all documents
   */
  readCursor<T extends Document, S extends Schema>(
    this: AdaptedModel<T> | AdaptedModelBySchema<S>,
    options: ReadContext<T>,
  ): Promise<void>
  /**
   * Reads documents in batches using skip/limit pagination.
   * Useful for chunked processing or parallelization.
   *
   * Defaults:
   *  - `useLean = true`        : Returns plain JavaScript objects instead of Mongoose documents
   *  - `limit = 0`             : No limit, reads all documents
   *  - `filter = {}`           : No filter, reads all documents
   *  - `batchSize` = 1000
   */
  readBatch<T extends Document, S extends Schema>(
    this: AdaptedModel<T> | AdaptedModelBySchema<S>,
    options: ReadContext<T>,
  ): Promise<void>
  /**
   * Efficiently reads documents from a Mongoose collection using different strategies.
   *
   * Supports three modes:
   *  - `'find'`    : Loads all matching documents into memory (may use a lot of RAM for large datasets)
   *  - `'cursor'`  : Streams documents one by one using a Mongoose cursor (memory-efficient)
   *  - `'batch'`   : Processes documents in batches (memory-efficient, good for large datasets)
   *
   * Optimized for performance and minimal memory usage.
   *
   * Defaults:
   *  - `mode = 'cursor'`       : Streams documents by default
   *  - `useLean = true`        : Returns plain JavaScript objects instead of Mongoose documents
   *  - `limit = 0`             : No limit, reads all documents
   *  - `batchSize = 1000`      : Number of documents per batch (for `'batch'` mode)
   *  - `filter = {}`           : No filter, reads all documents
   *  - `onDocument = undefined`: Optional callback for each document
   *
   * @template T - Mongoose document type (plain or lean)
   * @param model - Mongoose model instance (e.g., `User`)
   * @param options - Partial configuration options (see `ReadDocumentsOptions`). Defaults are applied for any missing options.
   * @returns Promise resolving to:
   *   - An array of documents for `'find'` mode
   *   - `void` for `'cursor'` and `'batch'` modes (callbacks or side-effects are used instead)
   */
  readDocuments<T extends Document, S extends Schema>(
    this: AdaptedModel<T> | AdaptedModelBySchema<S>,
    options: ReadDocumentsOptions<T>,
  ): Promise<void>

  /**
   * Paginate documents using traditional skip/limit strategy.
   * @template T - Mongoose document type (plain or lean)
   *
   * @param {Object} params - Pagination parameters.
   * @param {number} [params.page=1] - Current page number (1-based).
   * @param {number} [params.limit=10] - Number of documents per page.
   * @param {Record<string, unknown>} [params.filter={}] - MongoDB filter query.
   * @param {Record<string, 1 | -1>} [params.sort={ _id: 1 }] - Sort object.
   *
   * @returns {Promise<Object>} Result containing docs and metadata.
   * @returns {Array<Object>} return.docs - List of documents.
   * @returns {number} return.page - Current page number.
   * @returns {number} return.limit - Limit per page.
   * @returns {number} return.total - Total number of matching documents.
   * @returns {number} return.totalPages - Total number of pages.
   * @returns {boolean} return.hasNextPage - Whether another page exists.
   * @returns {boolean} return.hasPrevPage - Whether a previous page exists.
   */
  paginate<T extends Document>(this: AdaptedModel<T>, options?: {
    page?: number
    limit?: number
    filter?: Record<string, unknown>
    sort?: Record<string, 1 | -1>
    omit?: string[]
  }): Promise<{
    docs: T[]
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }>

  /**
   * Paginate documents using cursor-based strategy (more efficient).
   *
   * @param {Object} params - Pagination parameters.
   * @param {number} [params.limit=10] - Number of documents to return.
   * @param {Object} [params.filter={}] - MongoDB filter query.
   * @param {string|null} [params.cursor=null] - Last document _id for pagination.
   *
   * @returns {Promise<Object>} Result including cursor and documents.
   * @returns {Array<Object>} return.docs - List of paginated documents.
   * @returns {string|null} return.nextCursor - Cursor for next page, or null.
   * @returns {boolean} return.hasNextPage - Whether another page exists.
   */
  paginateCursor<T extends Document>(this: AdaptedModel<T>, options?: {
    limit?: number
    filter?: Record<string, unknown>
    cursor?: string | null
    omit?: string[]
  }): Promise<{
    docs: T[]
    limit: number
    nextCursor: string
    hasNextPage: boolean
  }>
}
