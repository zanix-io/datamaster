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
 * @example
 * ```ts
 * import {
 *   ZanixMongoConnector,
 *   defineModelHOC,
 *   transformRecursively,
 *   dataAccessGetter
 * } from 'jsr:@zanix/database@[version]/mod'
 *
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
 * @module zanixDatabase
 */

/**
 * DATABASE COMMONS
 */

// models
export { defineModelHOC } from './hocs/models.ts'

// accessors
export { dataProtectionGetter } from './data-policies/protection.ts'
export { dataAccessGetter } from './data-policies/access.ts'
export { dataPoliciesGetter } from './data-policies/mod.ts'

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
export { seedByIdIfMissing, seedManyByIdIfMissing } from 'mongo/utils/seeders.ts'

//transforms
export {
  transformDeepByPaths,
  transformRecursively,
} from 'mongo/processor/schema/transforms/recursively.ts'
export { transformByDataAccess } from 'mongo/processor/schema/transforms/data-access.ts'
export { transformShallowByPaths } from 'mongo/processor/schema/transforms/shallow.ts'

// main
export { ZanixMongoConnector } from 'mongo/connector/mod.ts'

/**
 * OTHER DATABASES...
 */
