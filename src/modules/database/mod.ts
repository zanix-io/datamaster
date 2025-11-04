/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * MONGO DATABASE
 */

// types
export type { EncryptedString, HashedString } from 'typings/data.ts'
export type { MongoConnectorOptions } from 'mongo/typings/process.ts'

// utils
export { getAllSubschemas } from 'mongo/utils/schemas.ts'
export { findPathsWithAccessorsDeep } from 'mongo/utils/accessors.ts'

//transforms
export {
  transformDeepByPaths,
  transformRecursively,
} from 'mongo/processor/schema/transforms/recursively.ts'
export { transformByDataAccess } from 'mongo/processor/schema/transforms/data-access.ts'
export { transformShallowByPaths } from 'mongo/processor/schema/transforms/shallow.ts'

// models
export { defineModelHOC } from './hocs/models.ts'

// accessors
export { dataProtectionGetter } from './data-policies/protection.ts'
export { dataAccessGetter } from './data-policies/access.ts'
export { dataPoliciesGetter } from './data-policies/mod.ts'

// main
export { ZanixMongoConnector } from 'mongo/connector/mod.ts'

/**
 * OTHER DATABASES...
 */
