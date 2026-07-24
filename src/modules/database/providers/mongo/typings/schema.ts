// deno-lint-ignore-file no-explicit-any
import type { BaseAttributes, Extensions, SchemaAccessor } from 'database/typings/general.ts'
import type { AnyObject, Schema, SchemaDefinition, SchemaDefinitionProperty } from 'mongoose'
import type { SchemaStatics } from './statics.ts'
import type { AdaptedModelBySchema } from './models.ts'
import type { SchemaMethods } from './commons.ts'

/** A Mongoose `Schema` with its `paths` map exposed for inspection. */
export type SchemaWithPaths = Schema & { paths: Record<string, any> }

/** A single field definition within a Mongoose schema. */
export type MongoField<T> = SchemaDefinitionProperty<T>

/**
 * Base custom schema
 *
 * The underlying `Schema` is pinned to fully-`any` generics (rather than left to default).
 * Mongoose 8's default generics for `Schema` are large, mutually-recursive conditional types
 * (`DocType`, `THydratedDocumentType`, ...) that get independently (re)expanded at each usage
 * site (e.g. `schema.get(...)` vs `schema.set(...)`), producing structurally-similar but not
 * identical anonymous types. Pinning them to `any` keeps every accessor consistent.
 */
export type BaseCustomSchema = {
  /** Static methods attached to the schema's model. */
  statics: SchemaStatics & Schema['statics']
  /** Instance methods attached to the schema's documents. */
  methods: SchemaMethods & Schema['methods']
} & Schema<any, any, any, any, any, any, any, any, any>

/**
 * Optional parameters to define a model by schema.
 *
 * Prefer `registerModel` for loading related or referenced models, as it handles binding and setup automatically
 */
export type SchemaModelInitOptions<S extends Schema> = {
  /**
   * Optional extensions added separately from the schema, including advanced customizations like seeders or accessors.
   */
  extensions?: Extensions
  /**
   * Models to explicitly bind and populate.
   */
  relatedModels?: { [modelName: string]: { schema: S; options?: SchemaModelInitOptions<S> } }
  /**
   * Callback to ensure asynchronous operations, such as running seeders, complete before proceeding
   */
  callback?: (Model: AdaptedModelBySchema<S>, msg: string) => void
}

/**
 * Defines a custom schema with additional attributes for `getModel` connector use
 *
 * @template Doc - The base Mongoose Document type.
 * @template Attrs - Additional attributes to extend the document schema.
 */
export type MongoSchemaDefinition<Attrs extends BaseAttributes> =
  | {
    [T in keyof SchemaDefinition<Attrs>]:
      & MongoField<Attrs>
      // Allows additional loosely-typed schema field options (e.g. custom or
      // rarely-used SchemaType properties) without forcing TypeScript to fully
      // resolve mongoose's `Schema` constructor generics for every field, which
      // (in mongoose 8) is deep enough to trip the compiler's recursion limit.
      & AnyObject
  }
  | Schema

/**
 * Represents a subschema and its path within a parent schema.
 */
export interface SubschemaInfo {
  /** Full dot-notated path to the subschema within the parent schema. */
  path: string
  /** The Mongoose Schema instance for this subschema. */
  schema: Schema
}

/**
 * Accesors info path
 */
export type AccessorsInfo = {
  /** Getters found in the schema, keyed by their dot-notated path. */
  getters: { [path: string]: SchemaAccessor[] }
  /** Setters found in the schema, keyed by their dot-notated path. */
  setters: { [path: string]: SchemaAccessor[] }
  /** `getters` flattened into `[path, accessors]` entry pairs. */
  getterEntries: [string, SchemaAccessor[]][]
  /** `setters` flattened into `[path, accessors]` entry pairs. */
  setterEntries: [string, SchemaAccessor[]][]
}

/** Tranform function type */
export type Transform = (
  // `doc`/`ret` are left as `any` (like `options`/the return type below): transforms run
  // against hydrated documents produced from arbitrary (often default-generic) schemas,
  // whose computed document/serialized-output shape varies per schema (e.g. `_id` may
  // resolve to `unknown` instead of `ObjectId`, and schema-added fields like `__v` are not
  // declared members of the `Document` class itself). A concrete `Document<...>` shape here
  // would reject the perfectly-valid, differently-shaped values mongoose actually passes in.
  doc: any,
  ret: any,
  options?: any,
) => any
