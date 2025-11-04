import type { BaseCustomSchema } from 'mongo/typings/schema.ts'

/**
 * @function methods
 * @description
 * Attaches custom **methods** to a Mongoose schema.
 *
 * These methods are available **directly on individual documents**.
 *
 * @param {BaseCustomSchema} _ - The schema instance to which static methods will be attached.
 *
 * @returns {void} Modifies the schema in-place by adding methods to `schema.methods`.
 */
export const methods = (
  _: BaseCustomSchema,
): void => {
}
