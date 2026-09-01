// deno-lint-ignore-file no-explicit-any
import type { UpsertTypeOptions } from 'mongo/typings/statics.ts'
import type { DataObject } from 'database/typings/models.ts'
import type { AdaptedModel } from 'mongo/typings/models.ts'

import logger from '@zanix/logger'

/** Max number of times a batch of individually-failed `bulkWrite` operations is retried. */
const MAX_BULK_WRITE_RETRIES = 3

/** Base delay (ms) before the first retry — doubles on each subsequent attempt. */
const BULK_WRITE_RETRY_BASE_DELAY_MS = 200

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs a `bulkWrite`, retrying only the operations MongoDB reports as failed (via
 * `MongoBulkWriteError.writeErrors`, each carrying the failing operation's index in the batch) —
 * not the whole batch. `ordered: false` already lets the *other* operations in a batch succeed
 * despite some failing; without this, a single transient failure (a momentary network blip, a
 * replica election, a write conflict) would still surface as a thrown error on every call, even
 * though most (or all, on a later attempt) of the batch actually landed.
 *
 * Recurses (rather than looping) so each retry is its own call, sidestepping the `no-await-in-loop`
 * lint rule this project enforces — the same convention used elsewhere for repeated/polling work.
 *
 * Gives up and re-throws the original error once `MAX_BULK_WRITE_RETRIES` is reached, or
 * immediately for an error that isn't a per-operation write-error batch (e.g. a connection failure
 * that would just fail identically on retry) — logging exactly which operations never landed
 * either way, so an operator investigating doesn't have to reconstruct that from a generic driver
 * exception.
 *
 * The immediate-rethrow path also covers `MongooseBulkWriteError` (thrown when the caller passes
 * `throwOnValidationError: true`, as `upsertManyById` does): mongoose casts/validates each op
 * client-side before it ever reaches the server, and a cast/validation failure (e.g. an `_id`
 * string that can't cast to ObjectId) is deterministic — it fails identically on every retry, so
 * this correctly never retries it. Unlike a real `MongoBulkWriteError`, it carries no
 * `.writeErrors` (its per-operation detail is on `.validationErrors` instead), so it's treated the
 * same as a connection failure here: surfaced immediately after any valid operations in the batch
 * have already been written.
 */
async function bulkWriteWithRetry(
  model: any,
  ops: any[],
  writeOptions: any,
  attempt = 0,
): Promise<void> {
  try {
    await model.bulkWrite(ops, writeOptions)
  } catch (error: any) {
    const writeErrors = error?.writeErrors ?? []

    if (!writeErrors.length || attempt >= MAX_BULK_WRITE_RETRIES) {
      if (writeErrors.length) {
        logger.error(
          `bulkWrite: giving up after ${attempt + 1} attempt(s) — ${writeErrors.length} of ` +
            `${ops.length} operation(s) never succeeded`,
          error,
          {
            meta: { source: 'zanix', operation: 'bulkWrite' },
            code: 'DATAMASTER_BULK_WRITE_RETRY_EXHAUSTED',
          },
        )
      }
      throw error
    }

    await delay(BULK_WRITE_RETRY_BASE_DELAY_MS * 2 ** attempt)

    const retryOps = writeErrors.map((writeError: any) => ops[writeError.index])
    await bulkWriteWithRetry(model, retryOps, writeOptions, attempt + 1)
  }
}

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
 * This method performs a `bulkWrite` for each object. Like {@link upsertById}, a document whose
 * `_id` can't be cast (e.g. a non-hex string against an `ObjectId` `_id`) rejects rather than
 * being silently dropped — mongoose still writes every other, validly-cast document in the batch
 * first, then throws for the ones that failed to cast.
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

  await bulkWriteWithRetry(this, ops, {
    ordered: false,
    writeConcern: { w: 'majority' },
    // Without this, mongoose silently drops operations that fail client-side casting/validation
    // (e.g. an `_id` string that can't cast to ObjectId) and, if EVERY op in the batch failed that
    // way, resolves with a synthetic zero-write success instead of surfacing anything — the caller
    // can't tell that apart from a legitimate no-op. Setting this makes mongoose throw a
    // `MongooseBulkWriteError` for those cast/validation failures instead, matching what
    // `upsertById`'s own `updateOne` already does (it throws `CastError` in the same situation).
    throwOnValidationError: true,
  })
}
