// deno-lint-ignore-file no-explicit-any ban-types
import type { BaseAttributes } from 'database/typings/general.ts'
import type { Session } from '@zanix/server'
import type {
  LeanDocument,
  Model as MongoModel,
  ResolveSchemaOptions,
  Schema,
  ToObjectOptions,
} from 'mongoose'

/**
 * Defines the shape of **methods** associated with a document.
 *
 * These methods are available on individual documents and can be overridden
 * for specific instances. Override them when concurrent modifications
 * need to be supported.
 */
export type SchemaMethods = {
  /**
   * Custom `toJSON` transformation (override).
   *
   * When `userSession` is managed through `AsyncLocalStorage` (ALS),
   * the object is serialized using `toJSON` with getters enabled.
   * Otherwise (when `userSession` is provided manually),
   * a shallow transform without getters is applied.
   *
   * Choose the approach that best fits your performance requirements.
   */
  toJSON<T = LeanDocument<Record<string, any>>>(
    options: Omit<ToObjectOptions, 'getters'> & { userSession: { type: Session['type'] } },
  ): T
}

/**
 * Represents a generic MongoModel with attributes and a schema.
 *
 * @template Attrs - The attribute types extending BaseAttributes (default is any).
 * @template S - The schema type, defaults to DefaultSchema<Attrs>.
 */
export type Model<Attrs extends BaseAttributes = any, S extends Schema = DefaultSchema<Attrs>> =
  MongoModel<Attrs, {}, SchemaMethods, {}, S>

/**
 * Represents the default schema type, with attributes extending BaseAttributes.
 * It uses the generic Schema type and defaults many parameters to empty or generic types.
 *
 * @template Attrs - The attribute types extending BaseAttributes (default is any).
 */
export type DefaultSchema<Attrs extends BaseAttributes = any> = Schema<
  any,
  MongoModel<any, any, any, any, any>,
  {},
  {},
  {},
  {},
  ResolveSchemaOptions<{}>,
  Attrs
>
