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
export { registerModel } from './defs/models.ts'

// accessors
export { dataProtectionGetter } from './policies/protection.ts'
export { dataAccessGetter } from './policies/access.ts'
export { dataPoliciesGetter } from './policies/mod.ts'

// types
export type {
  BaseModel,
  BaseModelDefinition,
  DataObject,
  ModelDef,
  ModelDefinition,
  ModelGeneralDefinition,
  SeedModelAttrs,
} from './typings/models.ts'
export type {
  BaseAttributes,
  BaseSeederHandler,
  DatabaseTypes,
  Extensions,
  SchemaAccessor,
  SeederHandler,
  SeederOptions,
} from './typings/general.ts'
export type {
  AndCondition,
  Condition,
  NotCondition,
  OrCondition,
  SingleCondition,
  TriggerActionCommons,
  TriggerActions,
  Triggers,
  TriggerTypes,
} from './typings/triggers.ts'
export type { NestedValue, Primitive } from 'typings/system.ts'
export type {
  AccessStrategies,
  AccessStrategiesSettings,
  DataAccessBaseConfig,
  DataAccessConfig,
  DataFieldAccess,
  DataPolicyVersion,
  DataProtection,
  DataProtectionBase,
  DataProtectionConfig,
  DataProtectionConfigs,
  DataProtectionMethods,
  DataProtectionOptions,
  DataProtectionSettings,
  EncryptionDataProtection,
  EncryptionProtectionConfig,
  EncryptSettings,
  HashingDataProtection,
  HashingLevels,
  HashingProtectionConfig,
  HashingSettings,
  InternalDataAccessConfig,
  InternalDataSettings,
  MaskingDataProtection,
  MaskingProtectionConfig,
  MaskingSettings,
  PrivateDataAccessConfig,
  PrivateDataSettings,
  ProtectedDataAccessConfig,
  ProtectedDataSettings,
} from 'typings/protection.ts'

/**
 * MONGO DATABASE
 */

// types
export type {
  DefaultSchema,
  Model as DatabaseModel,
  MongoSeeder,
  ReadContext,
  ReadDocumentsOptions,
} from 'mongo/typings/commons.ts'
export type {
  MongoConnectorOptions,
  PathDeepTransformOptions,
  PathTransformOptions,
  RecoursiveTransformOptions,
} from 'mongo/typings/process.ts'
export type { SchemaMethods } from 'mongo/typings/commons.ts'
export type {
  AccessorsInfo,
  BaseCustomSchema,
  MongoField,
  MongoSchemaDefinition,
  SchemaModelInitOptions,
  SchemaWithPaths,
  SubschemaInfo,
} from 'mongo/typings/schema.ts'
export type { SchemaStatics, UpsertTypeOptions } from 'mongo/typings/statics.ts'
export type {
  AdaptedModel,
  AdaptedModelBySchema,
  GetModelOptions,
  ModelBySchema,
  MongoModelDefinition,
} from 'mongo/typings/models.ts'
export type { Document, Model } from 'mongoose'
// utils
export { getAllSubschemas } from 'mongo/utils/schemas.ts'
export { findPathsWithAccessorsDeep } from 'mongo/utils/accessors.ts'

// seeders
export {
  seedByIdIfMissing,
  seedManyByIdIfMissing,
  seedRotateProtectionKeys,
} from 'mongo/utils/seeders.ts'

//transforms
export {
  transformDeepByPaths,
  transformRecursively,
} from 'mongo/processor/schema/transforms/recursively.ts'
export {
  transformByDataAccess,
  transformByDataProtection,
} from 'mongo/processor/schema/transforms/data-policies.ts'
export { transformShallowByPaths } from 'mongo/processor/schema/transforms/shallow.ts'

// main
export { ZanixMongoConnector } from 'mongo/connector/mod.ts'
export { Schema } from 'mongoose'

/**
 * SQLite
 */

export { ZanixKVStoreConnector } from './providers/sqlite/connector.ts'
export { LocalSQLite } from './utils/sqlite.ts'
/**
 * OTHER DATABASES...
 */
