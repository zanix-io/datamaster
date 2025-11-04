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
 * @property {boolean} [autoCached] - Whether to enable automatic caching. This feature is **experimental** and may not be fully implemented.
 */
export type MongoConnectorOptions = ConnectorOptions & {
  config?: ConnectOptions
  autoCached?: boolean
}
