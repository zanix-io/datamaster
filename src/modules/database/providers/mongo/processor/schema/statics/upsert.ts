import type { UpsertTypeOptions } from 'mongo/typings/statics.ts'
import type { DataObject } from 'database/typings/models.ts'
import type { AdaptedModel } from 'mongo/typings/models.ts'

/**
 * Finds a document by its `_id` and update or creates it if it does not exist.
 *
 * This method performs an `updateOne`
 *
 * @this {Model} The Mongo model instance.
 * @param {DataObject} data - The document data to use for creation.
 * @param {DataObject['id']} data.id - The unique identifier of the document.
 * @param {UpsertTypeOptions} options - The upsert type options
 * @param {UpsertTypeOptions['useDataPolicies']} options.useDataPolicies - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `false`.
 * @param {UpsertTypeOptions['type']} options.type - Determines the type of the operation. (e.g. insert, update). Defaults to `insert`
 *
 * @returns {Promise<void>} A promise that resolves to the MongoDB write result.
 *
 * @example
 * await User.upsertById({ id: 'abc123', name: 'Alice' });
 */
export async function upsertById(
  this: AdaptedModel,
  data: DataObject,
  options: UpsertTypeOptions = {},
): Promise<void> {
  const { useDataPolicies = false, type = 'insert' } = options

  if (useDataPolicies && this._hasDataProtection()) {
    return new Promise((next) =>
      this.schema.emit('upsertWithDataPolicy', this, data, { type }, next)
    )
  }

  const { id: _id, ...obj } = data
  const filter = { _id }

  // deno-lint-ignore no-explicit-any
  const props: { update?: any; options?: any } = {}

  if (type === 'insert') {
    props.update = { $setOnInsert: { ...obj, _id } }
    props.options = { upsert: true }
  } else {
    props.update = { $set: obj }
    props.options = {}
  }

  await this.updateOne(filter, props.update, props.options)
}

/**
 * Finds multiple documents by their `_id` and update or creates them if they do not exist.
 *
 * This method performs a `bulkWrite` for each object.
 *
 * @this {AdaptedModel} The Mongoose model.
 * @param {DataObject[]} data - Array of documents to insert if missing.
 * @param {UpsertTypeOptions} options - The upsert type options
 * @param {UpsertTypeOptions['useDataPolicies']} options.useDataPolicies - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `false`.
 * @param {UpsertTypeOptions['type']} options.type - Determines the type of the operation. (e.g. insert, update). Defaults to `insert`
 *
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
  options: UpsertTypeOptions = {},
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) return
  const [first, ...rest] = data

  if (rest.length === 0) return this.upsertById(first, options)

  const { useDataPolicies = false, type = 'insert' } = options

  if (useDataPolicies && this._hasDataProtection()) {
    return new Promise((next) =>
      this.schema.emit('upsertManyWithDataPolicy', this, data, { type }, next)
    )
  }

  const updateOne = type === 'insert'
    ? (data: DataObject) => {
      const { id: _id, ...obj } = data
      obj._id = _id

      return {
        filter: { _id },
        update: { $setOnInsert: obj },
        upsert: true,
      }
    }
    : (data: DataObject) => {
      const { id: _id, ...obj } = data
      return { filter: { _id }, update: { $set: obj } }
    }

  const ops = data.map((obj) => ({ updateOne: updateOne(obj) }))

  await this.bulkWrite(ops, { ordered: false, writeConcern: { w: 'majority' } })
}
