import { HttpError } from '@zanix/errors'

/**
 * Default upper bound for the `limit` of a paginated request: `SearchPaginationRTO` and
 * `ScrollPaginationRTO` reject a larger value with a 400. A service that needs a different bound
 * declares its own RTO with `PageLimit(max)` (see `rtos/pagination.ts`).
 *
 * `Model.paginate`/`Model.paginateCursor` do not apply this bound themselves: a direct caller is
 * trusted code that may legitimately read a larger page. They only reject values that are invalid
 * at any size (see {@link assertPaginationParams}).
 */
export const MAX_PAGE_LIMIT = 100

/** Whether `value` is an integer greater than or equal to 1. */
export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

/**
 * Converts a query-string numeric text (`'20'`, `' 2 '`) to a number and leaves every other value
 * untouched, so a non-numeric text, a blank string or an object reaches the validation as-is and
 * is rejected there instead of being coerced into `0` or `NaN`.
 */
export const toNumberIfNumeric = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const text = value.trim()
  return /^[+-]?\d+(\.\d+)?$/.test(text) ? Number(text) : value
}

/**
 * Validates the `page`/`limit` of a direct `Model.paginate`/`Model.paginateCursor` call: each one
 * that is given must be an integer greater than or equal to 1. It throws instead of clamping
 * because a clamp hides the caller's bug, and `limit: 0` must never mean "no limit" (MongoDB's own
 * reading of `limit(0)`).
 *
 * @param {Object} params - The pagination params to check; an `undefined` value is skipped
 * (the caller's default applies).
 * @throws {HttpError} `BAD_REQUEST` with code `DATAMASTER_INVALID_PAGINATION` when a value is out
 * of range.
 */
export const assertPaginationParams = (
  params: { page?: number; limit?: number },
): void => {
  for (const field of ['page', 'limit'] as const) {
    const value = params[field]
    if (value === undefined || isPositiveInteger(value)) continue

    throw new HttpError('BAD_REQUEST', {
      message: `'${field}' must be an integer greater than or equal to 1.`,
      code: 'DATAMASTER_INVALID_PAGINATION',
      meta: { source: 'zanix', field, received: String(value) },
    })
  }
}
