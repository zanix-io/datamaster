import type { MongoSeeder, ReadDocumentsOptions } from 'mongo/typings/commons.ts'
import type { DataObject } from 'database/typings/models.ts'
import type { Document } from 'mongoose'

import { transformByDataProtection } from 'mongo/processor/schema/transforms/data-policies.ts'
import logger from '@zanix/logger'

/**
 * Seeder handler that ensures a single document exists in the collection, identified by its `id`.
 * If the document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `updateOne` for simplicity and atomic upsert.
 *
 * @function seedByIdIfMissing
 * @param {DataObject} data - Object representing the document to seed, containing a unique `id` property.
 * @param {boolean} useDataPolicies - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `true`.
 *
 * @returns {MongoSeeder} A seeder function that upserts one document by ID.
 *
 * @example
 * await seedByIdIfMissing({ id: 'u1', name: 'Admin' })(UserModel)
 */
export function seedByIdIfMissing(
  data: DataObject,
  useDataPolicies: boolean = true,
): MongoSeeder {
  return async function seedByIdIfMissing(Model) {
    await Model.upsertById(data, { useDataPolicies })
  }
}

/**
 * Seeder handler that ensures multiple documents exist in the collection, each identified by its `id`.
 * If a document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `bulkWrite` for high performance and atomic upserts.
 *
 * @function seedManyByIdIfMissing
 * @param {Array<DataObject>} data - Array of objects to seed, each containing a unique `id` property.
 * @param {boolean} useDataPolicies - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `true`.
 *
 * @returns {MongoSeeder} A seeder function that upserts multiple documents by ID.
 *
 * @example
 * await seedManyByIdIfMissing([
 *   { id: 'u1', name: 'Admin' },
 *   { id: 'u2', name: 'User' }
 * ])(UserModel)
 */
export function seedManyByIdIfMissing(
  data: Array<DataObject>,
  useDataPolicies: boolean = true,
): MongoSeeder {
  return async function seedManyByIdIfMissing(Model) {
    await Model.upsertManyById(data, { useDataPolicies })
  }
}

/**
 * Rotates data protection keys across the database by re-encrypting or re-masking
 * all protected fields using the new set of secrets or keys.
 *
 * This seed should be executed whenever encryption, hashing, or masking keys
 * have been changed to ensure that all persisted protected data remains consistent
 * with the new protection policies.
 *
 * The process typically involves:
 * 1. Decrypting or unmasking existing protected data using the old keys.
 * 2. Reapplying protection (encryption, masking, hashing) with the new keys.
 * 3. Updating the database records with the newly protected values.
 *
 * ⚠️ **Important:** This operation may be computationally expensive and should
 * only be executed during maintenance windows or as part of a controlled key rotation process.
 *
 * @returns {Promise<void>} Resolves when all protected fields have been updated.
 */
export function seedRotateProtectionKeys(
  options?: Omit<ReadDocumentsOptions<Document>, 'onDocument' | 'useLean'>,
): MongoSeeder {
  return async function seedRotateProtectionKeys(Model) {
    if (!Model._hasDataProtection()) {
      return logger.warn(
        'No data protection configuration found. Skipping execution of [seedRotateProtectionKeys]. ' +
          'Ensure that the model has proper data protection settings before attempting key rotation.',
      )
    }

    const documents: DataObject[] = []
    await Model.readDocuments({
      ...options,
      useLean: false,
      onDocument: async (doc: Document) => {
        await transformByDataProtection()(doc, doc)

        const response = doc.toJSON({ getters: false, transform: false })
        delete response.updatedAt
        delete response._id
        documents.push(response as DataObject)
      },
    })

    await Model.upsertManyById(documents, { useDataPolicies: true, type: 'update' })
  }
}
