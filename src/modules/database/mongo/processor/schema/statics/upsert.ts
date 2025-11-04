import type { DataObject } from 'database/typings/models.ts'
import type { AdaptedModel } from 'mongo/typings/models.ts'

/**
 * Finds a document by its `_id` and creates it if it does not exist.
 *
 * This method performs an `updateOne` operation with `upsert: true`,
 * ensuring the document exists without modifying it if it already does.
 *
 * @this {Model} The Mongo model instance.
 * @param {DataObject} data - The document data to use for creation.
 * @param {DataObject['id']} data.id - The unique identifier of the document.
 * @returns {Promise<void>} A promise that resolves to the MongoDB write result.
 *
 * @example
 * await User.upsertById({ id: 'abc123', name: 'Alice' });
 */
export async function upsertById(
  this: AdaptedModel,
  data: DataObject,
): Promise<void> {
  const _id = data.id
  await this.updateOne(
    { _id },
    { $setOnInsert: { ...data, _id } },
    { upsert: true },
  )
}

/**
 * Finds multiple documents by their `_id` and creates them if they do not exist.
 *
 * This method performs a `bulkWrite` with `upsert: true` for each object,
 * ensuring each document exists without modifying existing ones.
 *
 * @this {AdaptedModel} The Mongoose model.
 * @param {DataObject[]} data - Array of documents to insert if missing.
 * @returns {Promise<void>} A promise that resolves to the bulk write result.
 *
 * @example
 * await User.upsertManyById([
 *   { id: 'abc123', name: 'Alice' },
 *   { id: 'def456', name: 'Bob' }
 * ]);
 */

export async function upsertManyById(
  this: AdaptedModel,
  data: DataObject[],
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) return
  const [first, ...rest] = data

  if (rest.length === 0) await this.upsertById(first)

  const ops = data.map((obj) => {
    const _id = obj.id
    return {
      updateOne: {
        filter: { _id },
        update: { $setOnInsert: { ...obj, _id } },
        upsert: true,
      },
    }
  })

  await this.bulkWrite(ops, { ordered: false, writeConcern: { w: 'majority' } })
}
