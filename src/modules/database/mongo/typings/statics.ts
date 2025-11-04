import type { generateHash, validateHash } from '@zanix/helpers'
import type { MaskingBaseOptions } from '@zanix/types'
import type { ClientSession } from 'mongoose'
import type { Model } from './commons.ts'

/**
 * Defines the shape of **static methods** attached to a schema (e.g., a Mongoose schema).
 *
 * Static methods are available **directly on the model** rather than on individual documents.
 * Use this type to ensure proper typing and IntelliSense when extending `schema.statics`.
 */
export type SchemaStatics = {
  /**
   * Encrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
   *
   * This function automatically selects the encryption method based on the key type provided.
   *
   * @see {@link import('jsr:@zanix/utils').encrypt} - The original encrypt function from @zanix/utils
   *
   * @param {string | string[]} message - The message or array of messages to encrypt.
   * @param {'sym-encrypt' | 'asym-encrypt'} type - The encryption tipe (symmetric or asymmetric)
   *
   * When type is `asym-encrypt`, it first checks for the environment `base64` variable `DATABASE_RSA_PUB`,
   * if not found, it falls back to `DATABASE_AES_KEY` and applies 'sym-encrypt' method.
   *
   * @returns {string | string[] } The encrypted message(s) as a base64 string or an array of base64 strings
   */
  encrypt: (
    message: string | string[],
    type?: 'sym-encrypt' | 'asym-encrypt',
  ) => Promise<string | string[]>
  /**
   * Decrypts a message using either **AES-GCM** (symmetric) or **RSA-OAEP** (asymmetric) encryption.
   *
   * @see {@link import('jsr:@zanix/utils').decrypt} - The original encrypt function from @zanix/utils
   *
   * @param {string | string[]} encryptedMessage - The message or array of messages to decrypt.
   * @param {'sym-encrypt' | 'asym-encrypt'} type - The encryption tipe (symmetric or asymmetric)
   *
   * When type is `asym-encrypt`, it first checks for the environment `base64` variable `DATABASE_RSA_KEY`,
   * if not found, it falls back to `DATABASE_AES_KEY` and applies 'sym-decrypt' method.
   *
   * @returns  {string} - The decrypted messahe
   */
  decrypt: (
    encryptedMessage: string | string[],
    type?: 'sym-encrypt' | 'asym-encrypt',
  ) => Promise<string | string[]>

  /**
   * Hash generation. Unidirectional encryption.
   *
   * @see {@link generateHash} - The original hash generation function from @zanix/utils
   */
  hash: typeof generateHash
  /**
   * Hash validation. Unidirectional encryption.
   *
   * @see {@link generateHash} - The original hash validation function from @zanix/utils
   */
  validateHash: typeof validateHash
  /**
   * Function to mask a message value.
   * This method use a secret key to mask. It first checks for the environment variable `DATABASE_SECRET_KEY`.
   * If not found, it falls back to `DATABASE_AES_KEY`.
   *
   * @see {@link https://jsr.io/@zanix/utils} - The original mask function from @zanix/utils
   */

  mask: (input: string | string[], options?: MaskingBaseOptions) => string | string[]
  /**
   * Function to unmask a message value.
   * This method use a secret key to unmask. It first checks for the environment variable `DATABASE_SECRET_KEY`.
   * If not found, it falls back to `DATABASE_AES_KEY`.
   *
   * @see {@link https://jsr.io/@zanix/utils} - The original unmask function from @zanix/utils
   */
  unmask: (input: string | string[], options?: MaskingBaseOptions) => string | string[]

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
}
