import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { DataAccessConfig, DataProtection } from 'typings/protection.ts'

import { decrypt, encrypt, mask, unmask } from 'utils/protection.ts'
import { generateHash, validateHash } from '@zanix/helpers'
import { transactions } from './transactions.ts'
import { upsertById, upsertManyById } from './upsert.ts'
import { readBatch, readCursor, readDocuments, readFind } from './find.ts'

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
  { dataAccess, dataProtection }: {
    dataAccess: Record<string, DataAccessConfig>
    dataProtection: Record<string, DataProtection>
  },
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

  schema.statics.readFind ??= readFind
  schema.statics.readCursor ??= readCursor
  schema.statics.readBatch ??= readBatch
  schema.statics.readDocuments ??= readDocuments

  const accessPaths = Object.keys(dataAccess)
  const hasAccess = accessPaths.length > 0
  schema.statics._getDataAccess = () => dataAccess
  schema.statics._getDataAccessPaths = () => accessPaths
  schema.statics._hasDataAccess = () => hasAccess

  const protectionPaths = Object.keys(dataProtection)
  const hasAProtection = protectionPaths.length > 0
  schema.statics._getDataProtection = () => dataProtection
  schema.statics._getDataProtectionPaths = () => protectionPaths
  schema.statics._hasDataProtection = () => hasAProtection
}
