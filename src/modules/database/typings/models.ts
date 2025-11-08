// deno-lint-ignore-file no-explicit-any
import type { MongoModelDefinition } from 'mongo/typings/models.ts'
import type { DatabaseTypes, Extensions } from './general.ts'
import type { Primitive } from 'typings/system.ts'

type ModelGeneralDefinition = Omit<ModelMetadata<unknown>, 'name'> & {
  /**
   * Represents optional extensions that can be added to a model definition.
   */
  extensions?: Extensions
}

type BaseModelDefinition = {
  extensions?: Omit<Extensions, 'seeders'>
}

type ModelDefinition<T extends DatabaseTypes, Attrs extends object> = 'mongo' extends T
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
 * Higher-order component (HOC) that enhances a base model with specific model definitions and optional configuration.
 * This type represents a function that takes a model, along with an optional type, and modifies or extends the model.
 * The default type is `'mongo'`, but it can be customized for different database types.
 *
 * @template T - The database type (default is `'mongo'`). This can be extended to support different database systems.
 * @template Attrs - The attributes or schema of the model, defaulting to `any`. This represents the structure or shape
 *                   of the model's data.
 *
 * @type ModelHOC
 *
 * @param {BaseModel & ModelDefinition<T, Attrs>} model - The base model and its definition that will be enhanced by the HOC.
 * @param {T} [type='mongo'] - An optional parameter to specify the database type (e.g., `'mongo'`, `'postgres'`, etc.).
 *                              Defaults to `'mongo'`.
 */
export type ModelHOC = <Attrs extends object = any, T extends DatabaseTypes = 'mongo'>(
  model: BaseModel<Attrs, T>,
  type?: T,
) => void

/**
 * Defines metadata for a model, including its name, schema definition, and an optional callback function.
 * This is typically used when defining a model in a higher-order component (HOC) like `defineModelHOC`.
 *
 * @template T - The type of the model definition, typically representing a schema or structure for the model.
 *
 * @type ModelMetadata
 * @property {string} name - The name of the model. This is used to identify the model and is typically a
 *                            string like 'User', 'Product', etc.
 * @property {T} definition - The model's schema or structure, defining the properties and their types
 *                             (e.g., `String`, `Date`, `Number`). This often includes validations, access
 *                             control, and other metadata about the properties.
 * @property {Function} [callback] - An optional callback function that can be used for additional model
 *                                   configurations or custom logic. It receives the schema and can return
 *                                   a modified version of it.
 * @property {T} options - The model's schema options
 */
export type ModelMetadata<T> = {
  name: string
  definition: T
  callback?: (...args: any[]) => unknown
  options?: object
} & BaseModelDefinition

/** Basic data object to save in a model */
export type DataObject = Record<string, object | Primitive | Primitive[]> & { id: string }
