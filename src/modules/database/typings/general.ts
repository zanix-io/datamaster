// deno-lint-ignore-file no-explicit-any
import type { Seeders } from '@zanix/server'
import type { Triggers } from './triggers.ts'

/**
 * Base attributes for a database entity or model.
 *
 * Represents the shape of the data stored in a database record.
 * Each key corresponds to a field or column (e.g. `id`, `name`, `createdAt`, etc.).
 */
export type BaseAttributes = Record<any, any>

/**
 * Database types
 */
export type DatabaseTypes = 'mongo' | 'postgress'

/**
 * Base seeder handler
 */
export type BaseSeederHandler = Seeders[0]['handlers'][0]

/**
 * Type representing a single seeder handler function.
 *
 * A SeederHandler defines the signature of a function used to populate a model with initial data.
 * It is typically passed to the model population system to insert or modify records during
 * database initialization or testing.
 */
export type SeederHandler = BaseSeederHandler | {
  handler: BaseSeederHandler
  options?: SeederOptions
}

/**
 * Represents optional extensions that can be added to a model definition.
 *
 * @property {SeederHandler} [seeders] - Optional array of seeder handler functions
 *   used to populate initial data in the model.
 * @property {Triggers} [triggers] - Optional triggers that define reactive behaviors or
 *   side effects tied to model events.
 */

export type Extensions = {
  /**
   * Optional array of seeder handler functions used to populate initial data in the model.
   * The seeders are executed **sequentially**.
   */
  seeders?: SeederHandler[]
  /**
   * Optional triggers that define reactive behaviors or side effects tied to model events.
   */
  triggers?: Triggers
}

/**
 * Schema accesor: set or get functions
 */
export type SchemaAccessor = (value: any, options?: any) => any

/**
 * Options for controlling the behavior of a seeder operation.
 */
export type SeederOptions = {
  /**
   * Indicates whether the seeder should be executed in a the background worker.
   * Useful for running heavy seed operations without blocking the main thread.
   * @default false
   */
  runOnWorker?: boolean
  /**
   * Enables verbose logging during the seeding process.
   * When true, additional details and progress information are printed to the console or logs.
   * @default true
   */
  verbose?: boolean
  /**
   * Defines the display name of the seeder used in logs when `verbose` is enabled.
   * If not provided, the name of the seeder function is used (when available and not anonymous).
   */
  name?: string
  /**
   * The version (SemVer) of the seeder operation, useful for tracking or debugging.
   * This helps to ensure the correct version of the seeder is used and to trigger a re-run
   * if the version has changed since the last execution.
   * @default '1.0.0'
   */
  version?: `${number}.${number}.${number}`
  /**
   * Defines the running mode of the seeder operation.
   * - 'always': Run the seeder every time, regardless of the version.
   * - 'ifVersionChanged': Run the seeder only when the version has changed.
   * @default 'ifVersionChanged'
   */
  runningMode?: 'always' | 'ifVersionChanged'
}

/** Seeder processor to execute actions on handler */
export type SeederProcessor = {
  prepare?: (version: SeederOptions['version'], name: string, model: any) => void
  avoidRun: (version: SeederOptions['version'], name: string, model: any) => boolean
  onFinish: (
    status: 'success' | 'failed',
    options: SeederOptions & { duration: number; error?: string },
    model: any,
  ) => unknown
}

/**
 * Represents a single Expired Value entry.
 */
export interface ExpiredValueEntry<V> {
  value: V
  expirationTime: number // 0 if no TTL
  ttl: number // ttl saved in milliseconds
}

/**
 * Represents a single KV entry.
 */
export interface KVEntry<V> extends ExpiredValueEntry<V> {
  key: string
}
