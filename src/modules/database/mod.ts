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
export type { SeedModelAttrs } from './typings/models.ts'

/**
 * MONGO DATABASE
 */

// types
export type { MongoSeeder } from 'mongo/typings/commons.ts'
export type { MongoConnectorOptions } from 'mongo/typings/process.ts'

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
