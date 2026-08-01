// deno-lint-ignore-file no-explicit-any
import type { MongoModelDefinition } from 'mongo/typings/models.ts'
import type { DatabaseTypes, Extensions } from './general.ts'
import type { Primitive } from 'typings/system.ts'
import type { Triggers } from './triggers.ts'

/**
 * Definition of a model for database types other than `'mongo'`.
 *
 * Kept as a public type (still re-exported from `database/mod.ts`) for backward compatibility,
 * but unreachable in practice today: `DatabaseTypes` only has one real member (`'mongo'`), so
 * {@link ModelDefinition}'s conditional below always resolves to `MongoModelDefinition`. This
 * isn't a bug — see `DatabaseTypes`' own doc comment for why a second backend isn't a small
 * follow-up.
 */
export type ModelGeneralDefinition = Omit<ModelMetadata<unknown>, 'name'> & {
  /**
   * Represents optional extensions that can be added to a model definition.
   */
  extensions?: Extensions
}

/** Base shape shared by every model definition, regardless of database type. */
export type BaseModelDefinition = {
  /** Optional extensions for the model, excluding seeders (handled separately per database type). */
  extensions?: Omit<Extensions, 'seeders'>
}

/**
 * Resolves to the model definition shape appropriate for the given database type. Always resolves
 * to `MongoModelDefinition` today — see {@link ModelGeneralDefinition}'s doc comment.
 */
export type ModelDefinition<T extends DatabaseTypes, Attrs extends object> = 'mongo' extends T
  ? MongoModelDefinition<Attrs>
  : ModelGeneralDefinition

/**
 * Represents the basic structure of a model with a `name` property.
 *
 * This type is used as a base for models that require a name field. It can be extended to include
 * additional properties or methods specific to the model.
 */
export type BaseModel<Attrs extends object, T extends DatabaseTypes> = {
  /**
   * The name of the model. This field is typically used to identify the model
   * and may represent a logical name or type of the model (e.g., 'User', 'Product').
   */
  name: string
} & ModelDefinition<T, Attrs>

/**
 * DSL definition that enhances a base model with specific model definitions and optional configuration.
 * This type represents a function that takes a model, along with an optional type, and modifies or extends the model.
 * The default type is `'mongo'`, but it can be customized for different database types.
 *
 * @template T - The database type (default is `'mongo'`) — `DatabaseTypes` only has one real member today, see its own doc comment for why.
 * @template Attrs - The attributes or schema of the model, defaulting to `any`. This represents the structure or shape
 *                   of the model's data.
 *
 * @type ModelDef
 *
 * @param {BaseModel & ModelDefinition<T, Attrs>} model - The base model and its definition that will be enhanced by the DSL definition.
 * @param {T} [type='mongo'] - An optional parameter to specify the database type. Defaults to, and today can only be, `'mongo'`.
 */
export type ModelDef = <Attrs extends object = any, T extends DatabaseTypes = 'mongo'>(
  model: BaseModel<Attrs, T>,
  type?: T,
) => void

/**
 * Defines metadata for a model, including its name, schema definition, and an optional callback function.
 * This is typically used when defining a model in a DSL definition like `registerModel`.
 *
 * @template T - The type of the model definition, typically representing a schema or structure for the model.
 *
 * @type ModelMetadata
 */
export type ModelMetadata<T> = {
  /** The name of the model. This is used to identify the model and is typically a string like 'User', 'Product', etc. */
  name: string
  /**
   * The model's schema or structure, defining the properties and their types
   * (e.g., `String`, `Date`, `Number`). This often includes validations, access
   * control, and other metadata about the properties.
   */
  definition: T
  /**
   * An optional callback function that can be used for additional model
   * configurations or custom logic. It receives the schema and can return
   * a modified version of it.
   */
  callback?: (...args: any[]) => unknown
  /** The model's schema options. */
  options?: object
} & BaseModelDefinition

/** Basic data object to save in a model. */
export type DataObject = Record<string, object | Primitive | Primitive[]> & {
  /** Unique identifier of the object, used to look it up or upsert it. */
  id: string
}

/** Attributes tracked for each executed seeder in the internal seed model. */
export type SeedModelAttrs = {
  /** Composite name identifying the model and seeder (e.g. `'model:SeederName'`). */
  name: string
  /** Whether the seeder run succeeded or failed. */
  status: 'success' | 'failed'
  /** The semantic version associated with this seeder run. */
  version: `${number}.${number}.${number}`
  /** Identifier of who or what triggered the seeder execution. */
  executedBy?: string
  /** How long the seeder took to run, in milliseconds. */
  duration?: number
  /** Additional free-form notes about the seeder run. */
  notes?: string
}

/**
 * Attributes for a persisted entry in the internal triggers model — the storage layer for
 * adding/toggling triggers at runtime ("online adaptation"), as opposed to the static
 * `extensions.triggers` declared in code. See `registerTriggersModel`.
 *
 * At connector startup, every `active` entry's `triggers` are merged into the target model's
 * (`model`) current effective trigger set. A non-default entry (`isDefault: false`) combines
 * with — never replacing — that model's static `extensions.triggers`. A **default** entry
 * (`isDefault: true`, auto-seeded from a model's own static `extensions.triggers` the first time
 * its connector boots with a triggers model enabled) instead **replaces** that model's static
 * layer entirely — this is what makes a code-defined trigger editable/disableable from this
 * collection without ever double-firing alongside its own code definition.
 *
 * A default entry stays in sync with its model's code: if the code no longer declares
 * `extensions.triggers` for it at all, the entry is deleted; if the code's content changed and
 * nobody edited `triggers` away from the last value synced from code, it's updated to match. An
 * entry someone DID edit directly (so `triggers` no longer matches `lastSyncedTriggers`) is left
 * alone — a manual edit always wins over a later code change, and is never silently overwritten.
 */
export type TriggersModelAttrs = {
  /** The name of the model this trigger configuration applies to. */
  model: string
  /** Whether this trigger configuration is currently active (merged in at startup). */
  active: boolean
  /** The trigger configuration to merge in, in the same shape as `extensions.triggers`. */
  triggers: Triggers
  /**
   * Whether this entry was auto-seeded from a model's static `extensions.triggers` (as opposed
   * to one created from scratch, e.g. via an admin endpoint). A default entry fully replaces its
   * target model's static trigger layer instead of combining with it — see the type-level doc.
   */
  isDefault: boolean
  /**
   * The code's `extensions.triggers` content as of the last time it was synced into `triggers`
   * (initial seed, or a later re-sync). Only meaningful for a default entry (`isDefault: true`) —
   * comparing this against the model's *current* static triggers is how a re-sync decides whether
   * `triggers` still matches what code last provided (safe to overwrite) or was edited directly
   * (must be left alone). Not present on non-default entries.
   */
  lastSyncedTriggers?: Triggers
}

/**
 * Fields accepted to create a new {@link TriggersModelAttrs} entry — derived from it so a caller
 * (`TriggersAdminRepository.create`, `@zanix/admin`'s `TriggersAdminClient`/`CreateTriggerRTO`)
 * never hand-re-declares this field list independently of the schema it targets.
 */
export type CreateTriggerInput = Pick<TriggersModelAttrs, 'model' | 'active' | 'triggers'>

/**
 * Fields accepted to update an existing {@link TriggersModelAttrs} entry — see
 * {@link CreateTriggerInput} for why this is derived rather than hand-declared.
 */
export type UpdateTriggerInput = Partial<Pick<TriggersModelAttrs, 'active' | 'triggers'>>
