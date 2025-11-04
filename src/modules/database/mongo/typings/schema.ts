// deno-lint-ignore-file no-explicit-any ban-types
import type { BaseAttributes, Extensions, SchemaAccessor } from 'database/typings/general.ts'
import type { generateHash, validateHash } from '@zanix/helpers'
import type { MaskingBaseOptions } from '@zanix/types'
import type { Seeders, Session } from '@zanix/server'
import type { Model } from './models.ts'
import type {
  ClientSession,
  Document,
  LeanDocument,
  Model as MongoModel,
  ResolveSchemaOptions,
  Schema,
  SchemaDefinition,
  SchemaDefinitionProperty,
  ToObjectOptions,
} from 'mongoose'

export type SchemaWithPaths = Schema & { paths: Record<string, any> }

type MongoField<T> = SchemaDefinitionProperty<T>

/**
 * Schema model extensions
 */
export interface SchemaModelExtensions extends Omit<Extensions, 'seeders'> {
  /**
   * Optional array of seeder handler functions used to populate initial data in the model.
   */
  seeders?: Seeders | Seeders[0]['handlers']
}

/**
 * Optional parameters to define a model by schema.
 *
 * Prefer `defineModelHOC` for loading related or referenced models, as it handles binding and setup automatically
 */
export type SchemaModelInitOptions<S extends Schema> = {
  /**
   * Optional extensions added separately from the schema, including advanced customizations like seeders or accessors.
   */
  extensions?: SchemaModelExtensions
  /**
   * Models to explicitly bind and populate.
   */
  relatedModels?: { [modelName: string]: { schema: S; options?: SchemaModelInitOptions<S> } }
}

/**
 * Defines a custom schema with additional attributes for `getModel` connector use
 *
 * @template Doc - The base Mongoose Document type.
 * @template Attrs - Additional attributes to extend the document schema.
 */
export type MongoSchemaDefinition<Attrs extends BaseAttributes> =
  | {
    [T in keyof SchemaDefinition<Attrs>]:
      & MongoField<Attrs>
      & ConstructorParameters<typeof Schema>[0]
  }
  | Schema

/**
 * Represents the default schema type, with attributes extending BaseAttributes.
 * It uses the generic Schema type and defaults many parameters to empty or generic types.
 *
 * @template Attrs - The attribute types extending BaseAttributes (default is any).
 */
export type DefaultSchema<Attrs extends BaseAttributes = any> = Schema<
  any,
  MongoModel<any, any, any, any, any>,
  {},
  {},
  {},
  {},
  ResolveSchemaOptions<{}>,
  Attrs
>

/**
 * Base custom schema
 */
export type BaseCustomSchema = {
  statics: SchemaStatics & Schema['statics']
  methods: SchemaMethods & Schema['methods']
} & Schema

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

/**
 * Defines the shape of **methods** associated with a document.
 *
 * These methods are available on individual documents and can be overridden
 * for specific instances. Override them when concurrent modifications
 * need to be supported.
 */
export type SchemaMethods = {
  /**
   * Custom `toJSON` transformation (override).
   *
   * When `userSession` is managed through `AsyncLocalStorage` (ALS),
   * the object is serialized using `toJSON` with getters enabled.
   * Otherwise (when `userSession` is provided manually),
   * a shallow transform without getters is applied.
   *
   * Choose the approach that best fits your performance requirements.
   */
  toJSON<T = LeanDocument<Record<string, any>>>(
    options: Omit<ToObjectOptions, 'getters'> & { userSession: { type: Session['type'] } },
  ): T
}

/**
 * Represents a subschema and its path within a parent schema.
 */
export interface SubschemaInfo {
  /** Full dot-notated path to the subschema within the parent schema. */
  path: string
  /** The Mongoose Schema instance for this subschema. */
  schema: Schema
}

/**
 * Accesors info path
 */
export type AccessorsInfo = {
  getters: { [path: string]: SchemaAccessor[] }
  setters: { [path: string]: SchemaAccessor[] }
  getterEntries: [string, SchemaAccessor[]][]
  setterEntries: [string, SchemaAccessor[]][]
}

/** Tranform function type */
export type Transform = (doc: Document, ret: Record<string, unknown>, options?: any) => any
