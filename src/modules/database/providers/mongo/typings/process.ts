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
  transformNested?: (
    value: any,
    type: 'array' | 'object',
  ) => NestedValue | Document
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
 * Every option below that also has an env var counterpart follows the same precedence rule as
 * `uri`/`MONGO_URI`: an explicit option always wins over the env var, which itself only applies
 * when the option is omitted entirely (not merely falsy) — see `ZanixMongoConnector`'s own
 * class-level doc for the full list.
 *
 * @property {ConnectorOptions} options - MongoDB connection information.
 * @property {ConnectorOptions} [options.uri] - URI of the MongoDB database.
 * @property {ConnectOptions} [config] - Additional configuration options for the connection.
 * @property {string | false} [seedModel] - Controls the creation of the seeder model:
 * - If `false`, no model is created.
 * - If a `string` is provided, a model is created with that name.
 * - If omitted, falls back to `SEED_MODEL_NAME` (env var; the literal string `'false'` disables
 *   it the same way), then a default model named `"zanix-seeders"` created **only if seeders are
 *   used**.
 */
export type MongoConnectorOptions = ConnectorOptions & {
  /** Mongo connection string URI. Falls back to `MONGO_URI` (env var) when omitted. */
  uri?: string
  /** Additional configuration options for the connection. */
  config?: ConnectOptions
  /** Controls the creation of the seeder model:
   * - If `false`, no model is created.
   * - If a `string` is provided, a model is created with that name.
   * - If omitted, falls back to `SEED_MODEL_NAME` (env var; the literal string `'false'` disables
   *   it the same way), then a default model named `"zanix-seeders"` created **only if seeders
   *   are used**.
   */
  seedModel?: string | false
  /**
   * Controls the creation of the persisted triggers model (see `registerTriggersModel`), used to
   * add/toggle triggers at runtime ("online adaptation") in addition to a model's static
   * `extensions.triggers`:
   * - If `false`, no model is created and no persisted triggers are loaded.
   * - If a `string` is provided, a model is created with that name.
   * - If omitted, falls back to `TRIGGERS_MODEL_NAME` (env var; the literal string `'false'`
   *   disables it the same way), then a default model named `"zanix-triggers"` created always.
   */
  triggersModel?: string | false
  /**
   * Re-reads the persisted triggers collection every `triggersPollInterval` milliseconds and
   * refreshes the in-memory registry — a safety net that catches changes a same-process
   * middleware refresh can't see (a write from a separate service, another replica, or a direct
   * database edit). `false` (the default) disables polling entirely; the collection is still
   * read once at startup, and still refreshed instantly for writes made through this connector's
   * own model (see the triggers model's post-save/update/delete hooks). If omitted, falls back to
   * `TRIGGERS_POLL_INTERVAL` (env var, milliseconds; unset, `'false'`, or a non-positive/
   * non-numeric value all disable it too).
   */
  triggersPollInterval?: number | false
  /**
   * Watches the persisted triggers collection via a MongoDB Change Stream and refreshes the
   * in-memory registry the moment any write is committed — including writes from other
   * processes/replicas, near-instantly, without waiting for `triggersPollInterval`. Requires the
   * connection to be a replica set or sharded cluster; if it isn't, starting the watch fails and
   * that failure is logged instead of throwing (the on-write and polling refresh paths keep
   * working regardless). `false` by default. If omitted, falls back to `TRIGGERS_CHANGE_STREAM`
   * (env var; set to the literal string `'true'` to enable).
   */
  triggersChangeStream?: boolean
}
