import type { ReadContext, ReadDocumentsOptions } from 'mongo/typings/commons.ts'
import type { AdaptedModel } from 'mongo/typings/models.ts'
import type { Document } from 'mongoose'

/**
 * Reads all documents into memory using `.find()`.
 * Fast, but memory-heavy.
 */
export async function readFind<T extends Document>(this: AdaptedModel, options: ReadContext<T>) {
  const { filter = {}, limit = 0, useLean = true, onDocument } = options

  let query = this.find(filter)
  if (limit > 0) query = query.limit(limit)
  if (useLean) query = query.lean()

  const docs = (await query.exec()) as T[]

  let i = 0
  for (const doc of docs) onDocument(doc, ++i)
}

/**
 * Streams documents one by one using a Mongoose cursor.
 * Most memory-efficient option.
 */
export async function readCursor<T extends Document>(this: AdaptedModel, options: ReadContext<T>) {
  const { filter = {}, limit = 0, useLean = true, onDocument } = options

  let query = this.find(filter)
  if (limit > 0) query = query.limit(limit)
  if (useLean) query = query.lean()

  const cursor = query.cursor()
  let count = 0

  for await (const doc of cursor) {
    count++
    await onDocument(doc as T, count)
  }
}

/**
 * Reads documents in batches using skip/limit pagination.
 * Useful for chunked processing or parallelization.
 */
export async function readBatch<T extends Document>(this: AdaptedModel, options: ReadContext<T>) {
  const { filter = {}, limit = 0, useLean = true, onDocument, batchSize = 1000 } = options

  // Streaming / batch read
  let query = this.find(filter)
  if (useLean) query = query.lean()
  const cursor = query.cursor()

  let total = 0

  for await (const doc of cursor) {
    total++

    await onDocument(doc as T, total)

    // Process batch if full or limit reached
    if ((total === batchSize || (limit > 0 && total >= limit))) {
      return
    }

    // Yield back to event loop periodically
    if (total % (batchSize * 10) === 0) {
      await new Promise((resolve) => queueMicrotask(() => resolve(true)))
    }

    if (limit > 0 && total >= limit) break
  }
}

/**
 * Efficiently reads documents from a Mongoose collection using different strategies.
 *
 * Supports:
 *  - Full memory read (`find`)
 *  - Streaming cursor (`cursor`)
 *  - Batch processing (`batch`)
 *
 * Optimized for performance and minimal memory usage.
 *
 * @template T - Mongoose document type (plain or lean)
 * @param model - Mongoose model instance (e.g., `User`)
 * @param options - Configuration options (see `ReadDocumentsOptions`)
 * @returns Array of documents (only for `find` mode) or void
 */
export function readDocuments<T extends Document>(
  this: AdaptedModel<T>,
  options: ReadDocumentsOptions<T>,
): Promise<void> {
  const { mode = 'cursor', ...opts } = options
  // deno-lint-ignore no-explicit-any
  const ctx: ReadContext<any> = opts

  switch (mode) {
    case 'find':
      return readFind.call(this, ctx)
    case 'cursor':
      return readCursor.call(this, ctx)
    case 'batch':
      return readBatch.call(this, ctx)
  }
}
