import { BaseRTO, IsString, Validation } from '@zanix/validator'
import { isPositiveInteger, MAX_PAGE_LIMIT, toNumberIfNumeric } from 'database/utils/pagination.ts'

/**
 * Decorator for a 1-based `page` accessor: an integer greater than or equal to 1. A numeric
 * query-string text is converted to a number first; anything else fails the validation (400).
 */
export const PageNumber = (): ReturnType<typeof Validation> =>
  Validation(isPositiveInteger, {
    message: (property: string) => `'${property}' must be an integer greater than or equal to 1.`,
    expose: true,
    transform: toNumberIfNumeric,
  })

/**
 * Decorator for a page-size `limit` accessor: an integer between 1 and `max`
 * (default {@link MAX_PAGE_LIMIT}). A numeric query-string text is converted to a number first;
 * anything else fails the validation (400).
 *
 * To use a different bound, extend the RTO and redeclare the accessor:
 *
 * @example
 * ```ts
 * class BulkSearchRTO extends SearchPaginationRTO {
 *   \@PageLimit(500)
 *   override accessor limit: number = 50
 * }
 * ```
 *
 * @param {number} [max=MAX_PAGE_LIMIT] - Largest accepted value.
 */
export const PageLimit = (max: number = MAX_PAGE_LIMIT): ReturnType<typeof Validation> =>
  Validation((value: unknown) => isPositiveInteger(value) && value <= max, {
    message: (property: string) => `'${property}' must be an integer between 1 and ${max}.`,
    expose: true,
    transform: toNumberIfNumeric,
  })

/**
 * Validates cursor-based pagination query params (`cursor`, `limit`) — matches the shape
 * `Model.paginateCursor` itself accepts.
 *
 * @example
 * ```ts
 * // ?cursor=507f191e810c19729de860ea&limit=20
 * \@RequestValidation({ Search: ScrollPaginationRTO })
 * public async list(ctx: HandlerContext) {
 *   const { cursor, limit } = ctx.search as ScrollPaginationRTO
 *   return Model.paginateCursor({ cursor, limit, filter })
 * }
 * ```
 */
export class ScrollPaginationRTO extends BaseRTO {
  /** The last document's `_id` from the previous page — omit for the first page. */
  @IsString({ expose: true, optional: true })
  accessor cursor: string | undefined

  /** Number of documents to return: an integer between 1 and `MAX_PAGE_LIMIT`. */
  @PageLimit()
  accessor limit: number = 10
}

/**
 * Validates skip/limit pagination query params (`page`, `limit`, `sortBy`) — matches the shape
 * `Model.paginate` itself accepts.
 *
 * `sortBy` arrives from the query string as `Record<string, string>` (HTTP query params are
 * always strings, e.g. `?sortBy[createdAt]=-1`) — this coerces every value to a number *before*
 * checking it's exactly `1` or `-1`, so `sortBy`'s declared `Record<string, 1 | -1>` type actually
 * matches what's on the instance at runtime, not just what TypeScript claims at compile time.
 * Passing the raw (still-string) values straight through to `Model.paginate`'s `sort` option
 * throws a Mongoose `TypeError: Invalid sort value` — Mongoose checks each value with strict
 * equality against the numbers `1`/`-1`, which a string like `'-1'` never satisfies.
 *
 * `page` must be an integer greater than or equal to 1 and `limit` an integer between 1 and
 * `MAX_PAGE_LIMIT`; a value outside that range (or a non-numeric one) fails the RTO validation with
 * a 400. Numeric query-string text is converted to a number before the check.
 *
 * @example
 * ```ts
 * // ?page=2&limit=20&sortBy[createdAt]=-1
 * \@RequestValidation({ Search: SearchPaginationRTO })
 * public async list(ctx: HandlerContext) {
 *   const { page, limit, sortBy } = ctx.search as SearchPaginationRTO
 *   return Model.paginate({ page, limit, sort: sortBy, filter })
 * }
 * ```
 */
export class SearchPaginationRTO extends BaseRTO {
  /** Current page number (1-based): an integer greater than or equal to 1. */
  @PageNumber()
  accessor page: number = 1

  /** Number of documents per page: an integer between 1 and `MAX_PAGE_LIMIT`. */
  @PageLimit()
  accessor limit: number = 10

  /** Sort object, e.g. `{ createdAt: -1 }` — every value must be exactly `1` or `-1`. */
  @Validation((value: unknown) => {
    return Boolean(value) &&
      Object.values(value as Record<string, unknown>).every((v) => v === 1 || v === -1)
  }, {
    message: 'The sortBy property should be a valid sort object. e.g. `?sortBy[createdAt]=1`',
    optional: true,
    expose: true,
    transform: (value: unknown) => {
      if (typeof value !== 'object' || value === null) return value
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map((
          [key, v],
        ) => [key, Number(v)]),
      )
    },
  })
  accessor sortBy: Record<string, 1 | -1> | undefined
}
