import type { MongoSeeder } from 'mongo/typings/commons.ts'
import type { DataObject } from 'database/typings/models.ts'
import logger from '@zanix/logger'

/**
 * Seeder handler that ensures a single document exists in the collection, identified by its `id`.
 * If the document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `updateOne` for simplicity and atomic upsert.
 *
 * @function seedByIdIfMissing
 * @param {Data} data
 *   Object representing the document to seed, containing a unique `id` property.
 * @returns {MongoSeeder} A seeder function that upserts one document by ID.
 *
 * @example
 * await seedByIdIfMissing({ id: 'u1', name: 'Admin' })(UserModel)
 */
export function seedByIdIfMissing(
  data: DataObject,
): MongoSeeder {
  return async function (Model) {
    try {
      await Model.upsertById(data)
    } catch (err) {
      logger.warn(`An error occurred during single upsert operation using [seedByIdIfMissing]`, err)
    }
  }
}

/**
 * Seeder handler that ensures multiple documents exist in the collection, each identified by its `id`.
 * If a document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `bulkWrite` for high performance and atomic upserts.
 *
 * @function seedManyByIdIfMissing
 * @param {Array<Data>} data
 *   Array of objects to seed, each containing a unique `id` property.
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
): MongoSeeder {
  return async function (Model) {
    try {
      await Model.upsertManyById(data)
    } catch (err) {
      logger.warn(
        `An error occurred during bulk upsert operation using [seedIfMissingByIdMultiple]`,
        err,
      )
    }
  }
}
