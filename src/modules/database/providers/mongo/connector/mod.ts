import type {
  AdaptedModel,
  AdaptedModelBySchema,
  GetModelOptions,
  MongoModelDefinition,
} from '../typings/models.ts'
import type { BaseCustomSchema, SchemaModelInitOptions } from '../typings/schema.ts'
import type { BaseAttributes, Extensions } from 'database/typings/general.ts'
import type { MongoConnectorOptions } from '../typings/process.ts'
import type { Model } from '../typings/commons.ts'

import { ProgramModule as ServerProgram, ZanixDatabaseConnector } from '@zanix/server'
import { createDatabase, postBindModel, preprocessSchema } from '../processor/mod.ts'
import { type Mongoose, Schema, type SchemaOptions } from 'mongoose'
import { defineModelBySchema, defineModels } from './models.ts'
import { loadPersistedTriggersOnStart } from './triggers.ts'
import { runSeedersOnStart } from './seeders.ts'
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'

/**
 * Manages the connection lifecycle with a MongoDB database using Mongoose,
 * providing utilities for model retrieval, schema processing, and connector customization.
 *
 * This connector serves as the MongoDB integration layer within the Zanix framework,
 * handling configuration, replica set awareness, and AsyncLocalStorage (ALS) context support
 * when required.
 *
 * Environment Variables:
 * - **MONGO_URI**: Optional. If set, this URI will be used as the default MongoDB connection string.
 *   Example: `MONGO_URI="mongodb://localhost:27017/my_database"`
 *
 * @class ZanixMongoConnector
 * @template T
 * @extends ZanixDatabaseConnector<T>
 *
 * @example
 * ```ts
 * const connector = new ZanixMongoConnector({
 *  uri: 'mongodb://localhost:27017',
 *  config: { dbName: 'my_database' },
 * })
 * ```
 *
 * @param {MongoConnectorOptions} [config={}] - Configuration parameters for connector customization.
 */
export class ZanixMongoConnector extends ZanixDatabaseConnector {
  #uri: string
  #database: Mongoose
  #config: MongoConnectorOptions['config']
  /** Whether the connection URI points to a replica set or sharded cluster. */
  private isReplicaSet?: boolean
  /** The connector's display name, used in logs. */
  protected name: string
  /** Name of the internal seed-tracking model, or `false` if seed tracking is disabled. */
  protected seederModel: string | false
  /** Name of the internal persisted triggers model, or `false` if it's disabled. */
  protected triggersModel: string | false
  /** Defines and binds a model initialized directly by a schema, bound as an instance method. */
  private defineModelBySchema = defineModelBySchema

  /** Creates a new MongoDB connector instance. */
  constructor(
    /**
     * Configuration params to connector customization
     */
    options: MongoConnectorOptions = {},
  ) {
    super()

    const targetName = this.constructor.name
    this.#uri = options?.uri || Deno.env.get('MONGO_URI') || 'mongodb://localhost'
    this.name = targetName.startsWith('_Zanix') ? 'database core' : targetName
    this.isReplicaSet = this.#uri?.includes('replicaSet=') || this.#uri?.includes('mongodb+srv://')
    this.#config = options.config
    this.seederModel = options.seedModel ?? 'zanix-seeders'
    this.triggersModel = options.triggersModel ?? 'zanix-triggers'

    this.#database = createDatabase()
  }

  /**
   * Registers a model in the database by binding its name to the provided schema.
   *
   * @param {string} name - The name of the model to bind.
   * @param {Schema} schema - The schema definition for the model.
   * @returns {Model} The registered model instance.
   */
  protected bindModel(
    name: string,
    schema: Schema,
    extensions?: Omit<Extensions, 'seeders'>,
  ): Model {
    const baseSchema = schema as BaseCustomSchema
    baseSchema.statics.isReplicaSet = () => this.isReplicaSet

    return this.#database.model(name, preprocessSchema(baseSchema, name, extensions))
  }

  /**
   * Retrieves a model instance by creating a new one based on the provided schema.
   *
   * - For advanced customization (e.g., seeders, triggers, dataPolicies), you can define them using the `extensions` option, or alternatively through `registerModel` for a higher-level setup.
   * - If seeders are not included via `extensions`, they should be executed separately using the `runSeeders` connector function.
   *
   * When accessing related models via this method:
   * - Ensure the referenced model has been bound or loaded prior to retrieval.
   * - If the model is not bound or loaded, and `relatedModels` is not supplied, the lookup will fail.
   * - If the related models require seed data, make sure their seeders are included in the `extensions.seeders` option.
   *
   * To avoid such issues, you should:
   * - Prefer `registerModel` for loading related or referenced models, as it handles binding and setup automatically, or
   * - Explicitly provide related models via `options.relatedModels` (`{ [modelName: string]: {schema: Schema, options?: SchemaModelInitOptions<S> }`) and any necessary seeders.
   *
   * **Warning:** Identifiers specified in schema `ref` fields must exactly match the corresponding keys in `relatedModels`. Using different identifiers will prevent proper model resolution.
   *
   * @param {Schema} schema - The schema definition used to create the model.
   * @param {GetModelOptions & SchemaModelInitOptions<S>} [options] - The model optional parameters.
   * @returns {Promise<AdaptedModelBySchema<S>>} The created model instance.
   */
  public getModel<S extends Schema>(
    name: string,
    schema: S,
    options?: GetModelOptions & SchemaModelInitOptions<S>,
  ): AdaptedModelBySchema<S>
  /**
   * Retrieves a model instance by creating a new one from a plain model definition — the same
   * `{definition, options, extensions, callback}` shape `registerModel` accepts — instead of an
   * already-constructed `Schema`. `definition`'s field markers (`String`, `Boolean`, `Date`, ...)
   * are plain JS globals, so a caller never needs to import `mongoose` to use this overload; the
   * `Schema` itself is built internally, the same way `defineModels()` builds one for every model
   * registered via `registerModel`.
   *
   * Prefer this over the `schema`-instance overload above whenever you don't already have a
   * `Schema` built (e.g. a caller that intentionally avoids a `mongoose` dependency) and don't
   * need `registerModel`'s full DSL (seeders auto-registration, deferred bootstrap-time binding).
   *
   * @param {MongoModelDefinition<Attrs>} definition - The model's plain definition, options, extensions, and optional schema callback.
   * @param {GetModelOptions} [options] - The general model options (e.g. `useALS`).
   * @returns {AdaptedModel<Attrs>} The created model instance.
   */
  public getModel<Attrs extends BaseAttributes>(
    name: string,
    definition: MongoModelDefinition<Attrs>,
    options?: GetModelOptions,
  ): AdaptedModel<Attrs>
  /**
   * Retrieves an already registered model by its name.
   *
   * **Note:** To have schemas available in this context, please use `registerModel`.
   *
   * @template Attrs - The base attributes type of the model.
   * @template Opts - The optional defined schema options.
   *
   * @param {string} name - The name of the registered model.
   * @param {GetModelOptions} options - The general model options.
   *
   * @returns {AdaptedModel<Attrs, Opts>} The corresponding model with schema available.
   */
  public getModel<Attrs extends BaseAttributes, Opts extends SchemaOptions = SchemaOptions>(
    name: string,
    options?: GetModelOptions,
  ): AdaptedModel<Attrs, Opts>
  /** Implementation shared by the {@link getModel} overloads above. */
  public getModel<Attrs extends BaseAttributes, S extends Schema>(
    name: string,
    entity?: S | MongoModelDefinition<Attrs> | GetModelOptions,
    options: GetModelOptions & SchemaModelInitOptions<S> = {},
  ): Model<Attrs> | AdaptedModelBySchema<S> {
    const hasSchema = entity instanceof Schema
    const hasDefinition = !hasSchema && !!entity && typeof entity === 'object' &&
      'definition' in entity

    // extending the ALS session for Model use
    if (
      hasSchema || hasDefinition ? options.useALS : (entity as GetModelOptions | undefined)?.useALS
    ) {
      ServerProgram.asyncContext.enterWith({
        id: this.context.id,
        session: { type: this.context.session?.type },
      })
    }

    const Model = this.#database.models[name] as Model<Attrs>

    if (Model) return postBindModel(Model)

    if (hasDefinition) {
      const { definition, options: schemaOptions, callback, extensions } =
        entity as MongoModelDefinition<Attrs>
      // `Schema`'s own generic constructor signature doesn't compose with a caller-supplied
      // `Attrs` the same way `defineModels()` gets away with it (that path works against loosely
      // typed registry metadata, not a real generic) — same mongoose typing friction, same `any`
      // escape hatch already used throughout this file's sibling modules.
      // deno-lint-ignore no-explicit-any
      const schema: any = new Schema(definition as any, schemaOptions)
      const finalSchema = callback ? callback(schema) : schema
      return this.defineModelBySchema(
        // deno-lint-ignore no-explicit-any
        { ...options, extensions: extensions as any },
        name,
        finalSchema,
      )
    }

    if (!hasSchema) {
      throw new HttpError('INTERNAL_SERVER_ERROR', {
        code: 'ERR_MONGO_MODEL_NOT_FOUND',
        message:
          'A required internal resource is missing. The system could not complete the operation.',
        cause:
          'Mongo model not found. To proceed, please use `registerModel` or supply a valid schema.',
        shouldLog: true,
      })
    }

    return this.defineModelBySchema<S>(options, name, entity)
  }

  /**
   * Establishes a connection to the MongoDB database using the provided URI.
   *
   * It initializes the Mongoose instance, applies the database configuration,
   * defines models, runs seeders if any, and logs the connection status.
   */
  protected async initialize() {
    try {
      const dbConfig = { ...this.#config }
      dbConfig.dbName = dbConfig.dbName || this.defaultDbName

      defineModels.call(this)

      await this.#database.connect(this.#uri, dbConfig)

      await loadPersistedTriggersOnStart.call(this)

      await runSeedersOnStart.call(this)

      const connected = this.#database.connection.readyState === 1

      if (connected) {
        logger.success(`MongoDB Connected Successfully through '${this.name}' class`)
      } else {
        logger.error(`Failed to connect to MongoDB in '${this.name}' class`, {
          code: 'MONGODB_CONNECTION_FAILED',
          meta: {
            suggestion: 'Check MongoDB URI, credentials, and network connectivity',
            connectorName: this.name,
            source: 'zanix',
          },
        })
      }
    } catch (error) {
      const { message, name, stack } = error as Error
      logger.error(
        `Unable to establish connection for database in '${this.name}' class.`,
        { message, name, stack },
        {
          code: 'MONGODB_CONNECTOR_MONGO_ERROR',
          meta: {
            connectorName: this.name,
            suggestion: 'Please check configuration or network settings',
            method: 'initialize',
            source: 'zanix',
          },
        },
      )
    }
  }

  /** Pings the MongoDB connection to check whether it is currently healthy. */
  public async isHealthy(): Promise<boolean> {
    try {
      const db = this.#database.connection.db
      if (!db) return false

      await db.command({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Gracefully closes the database connection.
   *
   * @returns {Promise<void>} A promise that resolves to `true` if the connection was closed successfully, or `false` otherwise.
   */
  protected async close(): Promise<void> {
    try {
      // Disconnect from mongo
      logger.info('Closing the MongoDB connection...', 'noSave')
      await this.#database.disconnect()
    } catch (e) {
      logger.error(
        `Failed to disconnect MongoDB in '${this.name}' class`,
        e,
        'noSave',
      )
    }
  }
}
