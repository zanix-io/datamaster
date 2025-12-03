import type { AdaptedModel } from 'mongo/typings/models.ts'
import type { SchemaStatics } from 'mongo/typings/statics.ts'

/**
 * Paginate documents using traditional skip/limit strategy.
 */
export const paginate: SchemaStatics['paginate'] = async function (
  this: AdaptedModel,
  options = {},
) {
  const { page = 1, limit = 10, filter = {}, sort = { _id: 1 }, omit = [] } = options
  const projection = omit.length ? omit.map((f) => `-${f}`).join(' ') : ''
  const skip = (page - 1) * limit

  const [docs, total] = await Promise.all([
    this.find(filter).sort(sort).skip(skip).limit(limit).select(projection),
    this.countDocuments(filter),
  ])

  return {
    docs,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  }
}

/**
 * Paginate documents using cursor-based strategy (more efficient).
 */
export const paginateCursor: SchemaStatics['paginateCursor'] = async function (
  this: AdaptedModel,
  options = {},
) {
  const { limit = 10, filter = {}, cursor = null, omit = [] } = options
  const query = { ...filter }
  const projection = omit.length ? omit.map((f) => `-${f}`).join(' ') : ''

  if (cursor) query._id = { $gt: cursor }

  const docs = await this.find(query)
    .sort({ _id: 1 })
    .limit(limit + 1).select(projection) // Fetch one extra to detect next page

  const hasNextPage = docs.length > limit
  const results = hasNextPage ? docs.slice(0, limit) : docs
  const nextCursor = hasNextPage ? results[results.length - 1]._id : null

  return {
    limit,
    docs: results,
    nextCursor,
    hasNextPage,
  }
}
