// deno-lint-ignore-file no-explicit-any
import type { MaskingBaseOptions } from '@zanix/types'
import type { Seeders } from '@zanix/server'
import type { Triggers } from './triggers.ts'

/**
 * Base attributes for a database entity or model.
 *
 * Represents the shape of the data stored in a database record.
 * Each key corresponds to a field or column (e.g. `id`, `name`, `createdAt`, etc.).
 */
export type BaseAttributes = Record<any, any>

/** Protection Methods */
type ProtectionMethods = 'masking' | 'sym-encrypt' | 'asym-encrypt' | 'hashing'

/**
 * Available protection methods for a data field.
 * Some require additional configuration (such as 'masking').
 */
export type DataProtectionMethod =
  | { type: Extract<ProtectionMethods, 'masking'>; options?: MaskingBaseOptions }
  | { type: ProtectionMethods }

export type DataProtectionMethodFull = ProtectionMethods | DataProtectionMethod

/** Access types */
type AccessTypes = 'private' | 'internal' | 'protected'

/**
 * Defines access to a data field.
 * If the type is 'protected', it may include options like virtual masking.
 */
export type DataFieldAccess =
  | {
    /**
     * Possible values:
     *   `protected`: The field is visible to authenticated users, and may be partially masked for anonymous users.
     *   `private`: The field is not shown at all to anonymous users and is only visible to authenticated users.
     *   `internal`: The field is not exposed to users at all.
     */
    type: Exclude<AccessTypes, 'protected'>
  }
  | {
    /**
     * When `protected` field access policy is applied, the field is visible to authenticated users, and may be partially masked for anonymous users.
     */
    type: Extract<AccessTypes, 'protected'>
    /**
     * Masking options
     */
    virtualMask?: MaskingBaseOptions
  }

/**
 * Defines access to a data field.
 *
 * If the type is 'protected', it may include options like virtual masking.
 * Possible values:
 *   `protected`: The field is visible to authenticated users, and may be partially masked for anonymous users.
 *   `private`: The field is not shown at all to anonymous users and is only visible to authenticated users.
 *   `internal`: The field is not exposed to users at all.
 */
export type DataFieldAccessFull = AccessTypes | DataFieldAccess

/**
 * Database types
 */
export type DatabaseTypes = 'mongo' | 'postgress'

/** Seeder Handler array of functions */
export type SeederHandlers = Seeders[0]['handlers']

/**
 * Type representing a single seeder handler function.
 *
 * A SeederHandler defines the signature of a function used to populate a model with initial data.
 * It is typically passed to the model population system to insert or modify records during
 * database initialization or testing.
 */
export type SeederHandler = SeederHandlers[0]

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
  seeders?: SeederHandlers
  /**
   * Optional triggers that define reactive behaviors or side effects tied to model events.
   */
  triggers?: Triggers
}

/**
 * Schema accesor: set or get functions
 */
export type SchemaAccessor = (value: any, options?: any) => any
