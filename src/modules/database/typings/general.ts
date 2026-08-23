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
  /**
   * Whether a document-level update (`doc.save()` on an existing, non-`isNew` document) should
   * automatically (re-)apply data protection to a protected path that was reassigned a genuinely
   * new value — as opposed to the current default, where only a document's first save (`isNew`)
   * and the explicit `upsertById`/`upsertManyById({ useDataPolicies: true })` path protect data.
   *
   * Detection compares each protected path's current value against a snapshot taken when the
   * document was hydrated from the database (not a content heuristic), so reassigning the exact
   * same already-protected value back (a no-op edit, or a partial update that round-trips other
   * fields) is never re-protected — safe even for `hash`, which can't otherwise be reversed to
   * check. See [Data Protection](../../docs/data-protection.md) for the full rationale.
   *
   * Falls back to the `AUTO_PROTECT_ON_DB_UPDATE` env var (`'true'` to enable) when omitted here —
   * an explicit value on this option always wins over that default. `false` when neither is set.
   *
   * Not yet supported for wildcard (`*`) protected paths (e.g. a per-element protected path inside
   * an array of subdocuments) — those keep today's behavior (no automatic update protection)
   * regardless of this option.
   */
  autoProtectOnUpdate?: boolean
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
  prepare?: (
    version: SeederOptions['version'],
    name: string,
    model: any,
  ) => void
  /** Determines whether a seeder run should be skipped (e.g. because it already ran at this version). */
  avoidRun: (
    version: SeederOptions['version'],
    name: string,
    model: any,
  ) => boolean
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
