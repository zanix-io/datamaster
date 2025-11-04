// deno-lint-ignore-file no-explicit-any
import type { BaseAttributes, Extensions, SchemaAccessor } from 'database/typings/general.ts'
import type { SchemaStatics } from './statics.ts'
import type { Seeders } from '@zanix/server'
import type { Document, Schema, SchemaDefinition, SchemaDefinitionProperty } from 'mongoose'
import type { SchemaMethods } from './commons.ts'

export type SchemaWithPaths = Schema & { paths: Record<string, any> }

type MongoField<T> = SchemaDefinitionProperty<T>

/**
 * Base custom schema
 */
export type BaseCustomSchema = {
  statics: SchemaStatics & Schema['statics']
  methods: SchemaMethods & Schema['methods']
} & Schema

/**
 * Schema model extensions
 */
export interface SchemaModelExtensions extends Omit<Extensions, 'seeders'> {
  /**
   * Optional array of seeder handler functions used to populate initial data in the model.
   */
  seeders?: Seeders | Seeders[0]['handlers']
}

/**
 * Optional parameters to define a model by schema.
 *
 * Prefer `defineModelHOC` for loading related or referenced models, as it handles binding and setup automatically
 */
export type SchemaModelInitOptions<S extends Schema> = {
  /**
   * Optional extensions added separately from the schema, including advanced customizations like seeders or accessors.
   */
  extensions?: SchemaModelExtensions
  /**
   * Models to explicitly bind and populate.
   */
  relatedModels?: { [modelName: string]: { schema: S; options?: SchemaModelInitOptions<S> } }
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
      & ConstructorParameters<typeof Schema>[0]
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
  getters: { [path: string]: SchemaAccessor[] }
  setters: { [path: string]: SchemaAccessor[] }
  getterEntries: [string, SchemaAccessor[]][]
  setterEntries: [string, SchemaAccessor[]][]
}

/** Tranform function type */
export type Transform = (doc: Document, ret: Record<string, unknown>, options?: any) => any
