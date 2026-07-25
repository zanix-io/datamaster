// deno-lint-ignore-file no-explicit-any
import type { NestedValue, Primitive } from 'typings/system.ts'
import type { ConnectorOptions } from '@zanix/server'
import type { ConnectOptions } from 'mongoose'
import type { Document } from 'mongoose'

/**
 * Transformation functions to apply to data.
 *
 * @template T
 */
export type RecoursiveTransformOptions = {
  /** Remove all metadata from each traversed path. */
  deleteMetadata?: boolean
  /** Function to transform primitive values (string, number, boolean, etc.). */
  transformPrimitive?: <T extends Primitive>(
    value: T,
  ) => T
  /** Function to transform non-primitive values (objects, arrays, Maps, etc.). */
  transformNested?: (value: any, type: 'array' | 'object') => NestedValue | Document
}

/**
 * Transformation functions with optional path filtering.
 */
export type PathDeepTransformOptions = RecoursiveTransformOptions & {
  /** List of paths allowed to be transformed. Paths should be dot-separated strings. */
  allowedPaths: string[]
}

/**
 * Transformation functions with optional path filtering.
 */
export type PathTransformOptions = {
  /** List of paths allowed to be transformed. Paths should be dot-separated strings. */
  allowedPaths: string[]
  /** Remove all metadata from each traversed path. */
  deleteMetadata?: boolean
  /** Function to transform values at a given path. */
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
  /**
   * Controls the creation of the persisted triggers model (see `registerTriggersModel`), used to
   * add/toggle triggers at runtime ("online adaptation") in addition to a model's static
   * `extensions.triggers`:
   * - If `false`, no model is created and no persisted triggers are loaded.
   * - If a `string` is provided, a model is created with that name.
   * - If omitted, a default model named `"zanix-triggers"` is always created.
   */
  triggersModel?: string | false
}
