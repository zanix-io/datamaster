import type { BaseCustomSchema } from 'mongo/typings/schema.ts'

import { decrypt, encrypt, mask, unmask } from 'database/utils/protection.ts'
import { generateHash, validateHash } from '@zanix/helpers'
import { transactions } from './transactions.ts'
import { upsertById, upsertManyById } from './upsert.ts'

/**
 * @function statics
 * @description
 * Attaches custom **static methods** to a Mongoose schema.
 *
 * Static methods are methods available **directly on the model** (not on individual documents).
 * This helper is typically used as a schema plugin to extend model-level functionality,
 * such as reusable database operations or utility methods.
 *
 * @param {BaseCustomSchema} schema - The schema instance to which static methods will be attached.
 *
 * @returns {void} Modifies the schema in-place by adding static methods to `schema.statics`.
 */
export const statics = (
  schema: BaseCustomSchema,
): void => {
  transactions(schema)

  schema.statics.encrypt ??= encrypt
  schema.statics.decrypt ??= decrypt

  schema.statics.mask ??= mask
  schema.statics.unmask ??= unmask

  schema.statics.hash ??= generateHash
  schema.statics.validateHash ??= validateHash

  schema.statics.upsertById ??= upsertById
  schema.statics.upsertManyById ??= upsertManyById
}
