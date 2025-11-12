// deno-lint-ignore-file no-explicit-any
import type { NestedValue, Primitive } from 'typings/system.ts'
import type { ConnectorOptions } from '@zanix/server'
import type { ConnectOptions } from 'mongoose'
import type { Document } from 'mongoose'

/**
 * Transformation functions to apply to data.
 *
 * @template T
 * @property {(value: T) => T} [transformPrimitive] - Function to transform primitive values (string, number, boolean, etc.).
 * @property {boolean} [deleteMetadata] - Remove all metadata from each traversed path
 * @property {(value: any, type: 'array' | 'object') => NestedValue | Document} [transformNested] - Function to transform non-primitive values (objects, arrays, Maps, etc.).
 */
export type RecoursiveTransformOptions = {
  deleteMetadata?: boolean
  transformPrimitive?: <T extends Primitive>(
    value: T,
  ) => T
  transformNested?: (value: any, type: 'array' | 'object') => NestedValue | Document
}

/**
 * Transformation functions with optional path filtering.
 *
 * @property {string[]} [allowedPaths] - List of paths allowed to be transformed. Paths should be dot-separated strings.
 */
export type PathDeepTransformOptions = RecoursiveTransformOptions & { allowedPaths: string[] }

/**
 * Transformation functions with optional path filtering.
 *
 * @property {string[]} [allowedPaths] - List of paths allowed to be transformed. Paths should be dot-separated strings.
 * @property {boolean} [deleteMetadata] - Remove all metadata from each traversed path
 * @property {<T extends NestedValue>(value: T) => T} [transform] - Function to transform values
 */
export type PathTransformOptions = {
  allowedPaths: string[]
  deleteMetadata?: boolean
  transform?: (value: any, path: string) => any
}

/**
 * Configuration for connecting to MongoDB.
 *
 * @property {ConnectorOptions} options - MongoDB connection information.
 * @property {ConnectorOptions} [options.uri] - URI of the MongoDB database.
 * @property {ConnectOptions} [config] - Additional configuration options for the connection.
 * @property {string | false} [seedModel] - Controls the creation of the seeder model:
 * - If `false`, no model is created.
 * - If a `string` is provided, a model is created with that name.
 * - If omitted, a default model named `"zanix-seeders"` is created **only if seeders are used**.
 */
export type MongoConnectorOptions = ConnectorOptions & {
  /** Mongo connection string URI */
  uri?: string
  /** Additional configuration options for the connection. */
  config?: ConnectOptions
  /** Controls the creation of the seeder model:
   * - If `false`, no model is created.
   * - If a `string` is provided, a model is created with that name.
   * - If omitted, a default model named `"zanix-seeders"` is created **only if seeders are used**.
   */
  seedModel?: string | false
}
