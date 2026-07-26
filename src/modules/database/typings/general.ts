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
 * Only `'mongo'` is currently supported.
 *
 * Datamaster's persistence layer is MongoDB-only. Supporting additional database backends would
 * require dedicated implementations beyond the current architecture.
 */
export type DatabaseTypes = 'mongo'

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
  /** The seeder function to execute. */
  handler: BaseSeederHandler
  /** Configuration options that customize how the seeder runs. */
  options?: SeederOptions
}

/**
 * Represents optional extensions that can be added to a model definition.
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

/** Seeder processor to execute actions on handler. */
export type SeederProcessor = {
  /** Registers the seeder's expected version and name before it runs, so it can later be tracked. */
  prepare?: (version: SeederOptions['version'], name: string, model: any) => void
  /** Determines whether a seeder run should be skipped (e.g. because it already ran at this version). */
  avoidRun: (version: SeederOptions['version'], name: string, model: any) => boolean
  /** Called after a seeder finishes, reporting whether it succeeded or failed. */
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
  /** The stored value. */
  value: V
  /** The absolute expiration timestamp in milliseconds, or `0` if no TTL was set. */
  expirationTime: number
  /** The TTL, in milliseconds, that was used to compute `expirationTime`. */
  ttl: number
}

/**
 * Represents a single KV entry.
 */
export interface KVEntry<V> extends ExpiredValueEntry<V> {
  /** The key this entry is stored under. */
  key: string
}
