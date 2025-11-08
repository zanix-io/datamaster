import type { AdaptedModel, AdaptedModelBySchema, GetModelOptions } from '../typings/models.ts'
import type { BaseCustomSchema, SchemaModelInitOptions } from '../typings/schema.ts'
import type { BaseAttributes, Extensions } from 'database/typings/general.ts'
import type { MongoConnectorOptions } from '../typings/process.ts'
import type { DefaultSchema, Model } from '../typings/commons.ts'

import { postBindModel, preprocessSchema } from '../processor/mod.ts'
import { Mongoose, Schema, type SchemaOptions } from 'mongoose'
import { defineModelBySchema, defineModels } from './models.ts'
import { runSeedersOnStart } from './seeders.ts'
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'
import {
  type CoreConnectorTemplates,
  ProgramModule as ServerProgram,
  ZanixDatabaseConnector,
} from '@zanix/server'

/**
 * Manages the connection lifecycle with a MongoDB database using Mongoose,
 * providing utilities for model retrieval, schema processing, and connector customization.
 *
 * This connector serves as the MongoDB integration layer within the Zanix framework,
 * handling configuration, replica set awareness, and AsyncLocalStorage (ALS) context support
 * when required.
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
 *  onConnected: () => {
 *    // Do something
 *  },
 *  onDisconnected: () => {
 *    // Do something
 *  },
 * })
 * ```
 *
 * @param {MongoConnectorOptions} [config={}] - Configuration parameters for connector customization.
 */
export class ZanixMongoConnector<T extends CoreConnectorTemplates = object>
  extends ZanixDatabaseConnector<T> {
  #database!: Mongoose
  #config: MongoConnectorOptions['config']
  private isReplicaSet?: boolean
  protected name: string
  protected seederModel: string | false
  private defineModelBySchema = defineModelBySchema

  constructor(
    /**
     * Configuration params to connector customization
     */
    options: MongoConnectorOptions = {},
  ) {
    const uri = options?.uri || Deno.env.get('MONGO_URI')
    const { onConnected, onDisconnected } = options
    super({ uri, onConnected, onDisconnected })

    const targetName = this.constructor.name
    this.name = targetName.startsWith('_Zanix') ? 'core database' : targetName
    this.isReplicaSet = uri?.includes('replicaSet=') || uri?.includes('mongodb+srv://')
    this.#config = options.config
    this.seederModel = options.seedModel ?? 'zanix-seeders'
  }

  /**
   * Registers a model in the database by binding its name to the provided schema.
   *
   * @param {string} name - The name of the model to bind.
   * @param {Schema} schema - The schema definition for the model.
   * @returns {Model} The registered model instance.
   */
  private bindModel(name: string, schema: Schema, extensions?: Omit<Extensions, 'seeders'>): Model {
    const baseSchema = schema as BaseCustomSchema
    baseSchema.statics.isReplicaSet = () => this.isReplicaSet

    return this.#database.model(name, preprocessSchema(baseSchema, extensions))
  }

  /**
   * Retrieves a model instance by creating a new one based on the provided schema.
   *
   * - For advanced customization (e.g., seeders, triggers, dataPolicies), you can define them using the `extensions` option, or alternatively through `defineModelHOC` for a higher-level setup.
   * - If seeders are not included via `extensions`, they should be executed separately using the `runSeeders` connector function.
   *
   * When accessing related models via this method:
   * - Ensure the referenced model has been bound or loaded prior to retrieval.
   * - If the model is not bound or loaded, and `relatedModels` is not supplied, the lookup will fail.
   * - If the related models require seed data, make sure their seeders are included in the `extensions.seeders` option.
   *
   * To avoid such issues, you should:
   * - Prefer `defineModelHOC` for loading related or referenced models, as it handles binding and setup automatically, or
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
  ): Promise<AdaptedModelBySchema<S>>
  /**
   * Retrieves an already registered model by its name.
   *
   * **Note:** To have schemas available in this context, please use `defineModelHOC`.
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
  public getModel<Attrs extends BaseAttributes, S extends DefaultSchema<Attrs>>(
    name: string,
    entity?: S | GetModelOptions,
    options: GetModelOptions & SchemaModelInitOptions<S> = {},
  ): Model<Attrs> | Promise<AdaptedModelBySchema<S>> {
    const hasSchema = entity instanceof Schema

    // extending the ALS session for Model use
    if (hasSchema ? options.useALS : entity?.useALS) {
      ServerProgram.asyncContext.enterWith({
        id: this.context.id,
        session: { type: this.context.session?.type },
      })
    }

    const Model = this.#database.models[name] as Model<Attrs>

    if (Model) return postBindModel(Model)

    if (!hasSchema) {
      throw new HttpError('INTERNAL_SERVER_ERROR', {
        code: 'ERR_MONGO_MODEL_NOT_FOUND',
        message:
          'A required internal resource is missing. The system could not complete the operation.',
        cause:
          'Mongo model not found. To proceed, please use `defineModelHOC` or supply a valid schema.',
      })
    }

    return this.defineModelBySchema<S>(options, name, entity)
  }

  /**
   * Establishes a connection to the MongoDB database using the provided URI.
   *
   * It initializes the Mongoose instance, applies the database configuration,
   * defines models, runs seeders if any, and logs the connection status.
   *
   * @param {string} uri - The MongoDB connection string URI. Defaults to constructor options URI
   * @returns {Promise<boolean>} A promise that resolves to `true` if the connection was successful.
   * @throws Will throw an error if the connection fails.
   */
  protected async startConnection(uri?: string): Promise<boolean> {
    try {
      if (!uri) throw new Deno.errors.Interrupted('Invalid mongo connection string')

      this.#database = new Mongoose()
      const dbConfig = { ...this.#config }
      dbConfig.dbName = dbConfig.dbName || this.defaultDbName

      defineModels.call(this)

      await this.#database.connect(uri, dbConfig)

      await runSeedersOnStart.call(this)

      const connected = this.#database.connection.readyState === 1

      if (connected) logger.success(`MongoDB Connected Successfully through '${this.name}' class`)
      else logger.error(`Failed to connect to MongoDB in '${this.name}' class`)

      return connected
    } catch (error) {
      const { message, name, stack } = error as Error
      logger.error(
        `Unable to establish connection for class '${this.name}'.`,
        {
          message: `Please check configuration or network settings.`,
          cause: { message, name, stack },
        },
      )
      return false
    }
  }

  /**
   * Gracefully closes the database connection.
   *
   * @returns {Promise<boolean>} A promise that resolves to `true` if the connection was closed successfully, or `false` otherwise.
   */
  protected async stopConnection(): Promise<boolean> {
    try {
      // Disconnect from mongo
      await this.#database.disconnect()
      return true
    } catch (e) {
      logger.error(`Failed to disconnect to MongoDB in '${this.constructor.name}' class`, e)
      return false
    }
  }
}
