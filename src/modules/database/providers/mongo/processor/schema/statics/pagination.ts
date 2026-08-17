import type { SchemaStatics } from 'mongo/typings/statics.ts'

/**
 * Combines a `buildSearchFilter` result with the caller's own `filter`, without ever merging their
 * top-level keys into one object — an `$or`/`$and`/`$nor` (or any other key) already present in
 * `filter` must never be silently overwritten by the search's own `$or`. Wrapping in `$and` is
 * correct regardless of what either side contains; skipped whenever one side is empty, so the
 * common case (no search, or no extra filter) never adds unnecessary nesting.
 */
const combineFilters = (
  search: Record<string, unknown>,
  filter: Record<string, unknown>,
): Record<string, unknown> => {
  const hasSearch = Object.keys(search).length > 0
  const hasFilter = Object.keys(filter).length > 0

  if (!hasSearch) return filter
  if (!hasFilter) return search

  return { $and: [search, filter] }
}

/**
 * Paginate documents using traditional skip/limit strategy.
 */
export const paginate: SchemaStatics['paginate'] = async function (
  options = {},
) {
  const {
    page = 1,
    limit = 10,
    filter: filterOption = {},
    sort = { _id: 1 },
    omit = [],
    useDataPolicies,
    search,
  } = options
  const filter = search
    ? combineFilters(
      this.buildSearchFilter(search.query, search.fields),
      filterOption,
    )
    : filterOption
  const projection = omit.length ? omit.map((f) => `-${f}`).join(' ') : ''
  const skip = (page - 1) * limit

  const [docs, total] = await Promise.all([
    this.find(filter, null, { useDataPolicies }).sort(sort).skip(skip).limit(
      limit,
    ).select(
      projection,
    ),
    this.countDocuments(filter, { useDataPolicies }),
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
  options = {},
) {
  const {
    limit = 10,
    filter: filterOption = {},
    cursor = null,
    omit = [],
    useDataPolicies,
    search,
  } = options
  const filter = search
    ? combineFilters(
      this.buildSearchFilter(search.query, search.fields),
      filterOption,
    )
    : filterOption
  const query = { ...filter }
  const projection = omit.length ? omit.map((f) => `-${f}`).join(' ') : ''

  if (cursor) query._id = { $gt: cursor }

  const docs = await this.find(query, null, { useDataPolicies })
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
