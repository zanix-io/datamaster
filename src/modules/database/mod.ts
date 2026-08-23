/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * This module provides database utilities and connectors for the Zanix project.
 *
 * It includes type definitions, schema utilities, data accessors, and transformation
 * functions for working with MongoDB and other databases.
 *
 * The main export, `ZanixMongoConnector`, provides a MongoDB connection handler with
 * support for schema transformation, data policies, and model definition utilities.
 *
 * @module zanixDatabase
 */

/**
 * DATABASE COMMONS
 */

// models
export {
  /** A DSL definition that adds a model to the `ProgramModule`'s model registry. */
  registerModel,
} from './defs/models.ts'

// pagination RTOs
export {
  /** Validates cursor-based pagination query params (`cursor`, `limit`) — matches `Model.paginateCursor`'s own shape. */
  ScrollPaginationRTO,
  /** Validates skip/limit pagination query params (`page`, `limit`, `sortBy`) — matches `Model.paginate`'s own shape. */
  SearchPaginationRTO,
} from './rtos/pagination.ts'

// accessors
export {
  /** Creates a schema accessor that transparently applies data protection operations (such as `decrypt` or `unmask`) when reading a protected field. */
  dataProtectionGetter,
} from './policies/protection.ts'
export {
  /** Set the access policy for a given data field (string or string array), applying the specified base getter function. */
  dataAccessGetter,
} from './policies/access.ts'
export {
  /** Defines the data protection and access control behavior for a specific data field (either a single string field or an array of strings). */
  dataPoliciesGetter,
} from './policies/mod.ts'

// types
export type {
  /** Represents the basic structure of a model with a `name` property. */
  BaseModel,
  /** Base shape shared by every model definition, regardless of database type. */
  BaseModelDefinition,
  /** Fields accepted to create a new triggers-model entry — derived from `TriggersModelAttrs`. */
  CreateTriggerInput,
  /** Basic data object to save in a model. */
  DataObject,
  /** DSL definition that enhances a base model with specific model definitions and optional configuration. */
  ModelDef,
  /** Resolves to the model definition shape appropriate for the given database type. */
  ModelDefinition,
  /** Definition of a model for database types other than `'mongo'`. */
  ModelGeneralDefinition,
  /** Attributes tracked for each executed seeder in the internal seed model. */
  SeedModelAttrs,
  /** Attributes for a persisted entry in the internal triggers model. */
  TriggersModelAttrs,
  /** Fields accepted to update an existing triggers-model entry — derived from `TriggersModelAttrs`. */
  UpdateTriggerInput,
} from './typings/models.ts'
export type {
  /** Base attributes for a database entity or model. */
  BaseAttributes,
  /** Base seeder handler. */
  BaseSeederHandler,
  /** Database types. */
  DatabaseTypes,
  /** Represents optional extensions that can be added to a model definition. */
  Extensions,
  /** Schema accessor: set or get functions. */
  SchemaAccessor,
  /** Type representing a single seeder handler function. */
  SeederHandler,
  /** Options for controlling the behavior of a seeder operation. */
  SeederOptions,
} from './typings/general.ts'
export {
  /** The well-known job names datamaster dispatches built-in trigger actions to. */
  DEFAULT_TRIGGER_JOBS,
} from './typings/triggers.ts'
export {
  /** Every trigger-action job descriptor registered so far via `registerTriggerActionJob`. */
  getRegisteredTriggerActionJobs,
  /** Registers the job a built-in trigger action kind (`mail`, `request`, ...) dispatches to. */
  registerTriggerActionJob,
} from './defs/trigger-actions.ts'
export type {
  /** Built-in trigger action kinds whose job resolution goes through `registerTriggerActionJob`. */
  BuiltInTriggerActionType,
  /** Everything needed to register a real job for a built-in trigger action kind. */
  TriggerActionJobDescriptor,
  /** A trigger-action job's execution logic — a minimal structural context, not `@zanix/asyncmq`'s own `Job` type. */
  TriggerActionJobHandler,
} from './defs/trigger-actions.ts'
export type {
  /** Represents a logical AND condition combining multiple conditions. */
  AndCondition,
  /** A condition which can be a single comparison or a composite logical condition. */
  Condition,
  /** Represents a logical NOT condition negating multiple conditions. */
  NotCondition,
  /** Represents a logical OR condition combining multiple conditions. */
  OrCondition,
  /** Represents a single condition for filtering or matching. */
  SingleCondition,
  /** Common properties for trigger actions. */
  TriggerActionCommons,
  /** Defines the specific types of trigger actions. */
  TriggerActions,
  /** Represents triggers categorized by their timing ('pre' or 'post') and event types. */
  Triggers,
  /** Defines trigger types mapped to arrays of trigger actions. */
  TriggerTypes,
} from './typings/triggers.ts'
export type {
  /** A value that may recursively contain primitives, arrays, or plain objects. */
  NestedValue,
  /** Any JavaScript primitive value. */
  Primitive,
} from 'typings/system.ts'
export type {
  /** Available data access strategies. */
  AccessStrategies,
  /** Group of all available data access settings by strategy. */
  AccessStrategiesSettings,
  /** Configuration for a single data access strategy. */
  DataAccessBaseConfig,
  /** Union of all single-strategy data access configurations. */
  DataAccessConfig,
  /** Defines access to a data field. */
  DataFieldAccess,
  /** Data policy version type. */
  DataPolicyVersion,
  /** Union of all versioned data protection types. */
  DataProtection,
  /** Base configuration for a versioned data protection strategy. */
  DataProtectionBase,
  /** Configuration for a single data protection strategy. */
  DataProtectionConfig,
  /** Union of all single-strategy data protection configurations. */
  DataProtectionConfigs,
  /** Available data protection strategies. */
  DataProtectionMethods,
  /** Type representing any valid data protection option. */
  DataProtectionOptions,
  /** Group of all available data protection settings by strategy. */
  DataProtectionSettings,
  /** Versioned encryption protection configuration. */
  EncryptionDataProtection,
  /** Encryption protection configuration. */
  EncryptionProtectionConfig,
  /** Encryption data protection settings. */
  EncryptSettings,
  /** Versioned hashing protection configuration. */
  HashingDataProtection,
  /** Defines the security level of the hash: 'low', 'medium', 'medium-high', or 'high'. */
  HashingLevels,
  /** Hashing protection configuration. */
  HashingProtectionConfig,
  /** Hashing data protection settings. */
  HashingSettings,
  /** Access configuration for the 'internal' strategy. */
  InternalDataAccessConfig,
  /** The field is visible only to internal/trusted callers; no settings apply. */
  InternalDataSettings,
  /** Versioned masking protection configuration. */
  MaskingDataProtection,
  /** Masking protection configuration. */
  MaskingProtectionConfig,
  /** Masking data protection settings. */
  MaskingSettings,
  /** Access configuration for the 'private' strategy. */
  PrivateDataAccessConfig,
  /** The field is never visible outside the owning process; no settings apply. */
  PrivateDataSettings,
  /** Access configuration for the 'protected' strategy. */
  ProtectedDataAccessConfig,
  /** The field is visible to authenticated users, and may be partially masked for anonymous users. */
  ProtectedDataSettings,
} from 'typings/protection.ts'

/**
 * MONGO DATABASE
 */

// types
export type {
  /** Represents the default schema type, with attributes extending BaseAttributes. */
  DefaultSchema,
  /** Represents a generic MongoModel with attributes and a schema. */
  Model as DatabaseModel,
  /** Type representing a single seeder handler function for Mongo. */
  MongoSeeder,
  /** Common parameters passed to internal strategy functions. */
  ReadContext,
  /** Options for the `readDocuments` utility. */
  ReadDocumentsOptions,
} from 'mongo/typings/commons.ts'
export type {
  /** Configuration for connecting to MongoDB. */
  MongoConnectorOptions,
  /** Transformation functions with optional path filtering. */
  PathDeepTransformOptions,
  /** Transformation functions with optional path filtering. */
  PathTransformOptions,
  /** Transformation functions to apply to data. */
  RecoursiveTransformOptions,
} from 'mongo/typings/process.ts'
export type {
  /** Defines the shape of **methods** associated with a document. */
  SchemaMethods,
} from 'mongo/typings/commons.ts'
export type {
  /** Accessor info for a schema path. */
  AccessorsInfo,
  /** A custom Mongoose schema shape with generics pinned to `any` for consistent accessor typing. */
  BaseCustomSchema,
  /** A single field definition within a Mongoose schema. */
  MongoField,
  /** Defines a custom schema with additional attributes for `getModel` connector use. */
  MongoSchemaDefinition,
  /** Optional parameters to define a model by schema. */
  SchemaModelInitOptions,
  /** A Mongoose `Schema` with its `paths` map exposed for inspection. */
  SchemaWithPaths,
  /** Represents a subschema and its path within a parent schema. */
  SubschemaInfo,
} from 'mongo/typings/schema.ts'
export type {
  /** Defines the shape of **static methods** attached to a schema. */
  SchemaStatics,
  /** Upsert type options. */
  UpsertTypeOptions,
} from 'mongo/typings/statics.ts'
export type {
  /** Represents a generic MongoModel with attributes, options and a schema. */
  AdaptedModel,
  /** Represents a generic MongoModel generated by a schema with attributes. */
  AdaptedModelBySchema,
  /** Connector Model general options. */
  GetModelOptions,
  /** Represents a model constructed from a given schema type. */
  ModelBySchema,
  /** Defines the structure of a MongoDB model, including its schema definition, options, and an optional callback function. */
  MongoModelDefinition,
} from 'mongo/typings/models.ts'
export type { Document, Model } from 'mongoose'
// utils
export {
  /** Recursively collects all nested (sub)schemas from a given Mongoose schema. */
  getAllSubschemas,
} from 'mongo/utils/schemas.ts'
export {
  /** Recursively finds all paths in a schema that have getters or setters defined. */
  findPathsWithAccessorsDeep,
} from 'mongo/utils/accessors.ts'

// seeders
export {
  /** Reports, per protected path, how many documents are still on an older protection version than the one currently active. */
  checkProtectionRotationStatus,
  /** Seeder handler that ensures a single document exists in the collection, identified by its `id`. */
  seedByIdIfMissing,
  /** Seeder handler that ensures multiple documents exist in the collection, each identified by its `id`. */
  seedManyByIdIfMissing,
  /** Rotates data protection keys across the database by re-encrypting or re-masking all protected fields. */
  seedRotateProtectionKeys,
} from 'mongo/utils/seeders.ts'

export type { ProtectionRotationStatus } from 'mongo/utils/seeders.ts'

//transforms
export {
  /** Transforms a data structure by applying the provided transformation functions to specific paths. */
  transformDeepByPaths,
  /** Recursively transforms a data structure (object, array, Map, etc.) by applying the provided transformation functions. */
  transformRecursively,
} from 'mongo/processor/schema/transforms/recursively.ts'
export {
  /** Enables and applies the data access policy during Mongoose document transformation (`toJSON` or `toObject`). */
  transformByDataAccess,
  /** Reverses the data protection policy during Mongoose document transformations (`toJSON` or `toObject`). */
  transformByDataProtection,
} from 'mongo/processor/schema/transforms/data-policies.ts'
export {
  /** Applies a transformation function to specific paths in a data structure at a shallow level. */
  transformShallowByPaths,
} from 'mongo/processor/schema/transforms/shallow.ts'

// main
export {
  /** Default persisted-triggers collection name when `TRIGGERS_MODEL_NAME` isn't set. */
  DEFAULT_TRIGGERS_MODEL,
  /** Whether the persisted triggers module was explicitly disabled (`TRIGGERS_MODEL_NAME=false`). */
  isTriggersModelDisabled,
  /** Whether the triggers resource is configured in this deployment — the inverse of
   * `isTriggersModelDisabled`, on by default. */
  isTriggersResourceEnabled,
  /** Env var name for `SEED_MODEL_NAME`. */
  SEED_MODEL_ENV,
  /** Env var name for `TRIGGERS_CHANGE_STREAM`. */
  TRIGGERS_CHANGE_STREAM_ENV,
  /** Env var name for `TRIGGERS_MODEL_NAME`. */
  TRIGGERS_MODEL_ENV,
  /** Env var name for `TRIGGERS_POLL_INTERVAL`. */
  TRIGGERS_POLL_INTERVAL_ENV,
  /** Resolves the effective persisted-triggers collection name. */
  triggersModelName,
  /** Manages the connection lifecycle with a MongoDB database using Mongoose. */
  ZanixMongoConnector,
} from 'mongo/connector/mod.ts'
export {
  /** Env var name for `DATABASE_SEEDERS`. */
  DATABASE_SEEDERS_ENV,
} from 'database/utils/constants.ts'
export { Schema } from 'mongoose'

/**
 * OTHER DATABASES...
 */
