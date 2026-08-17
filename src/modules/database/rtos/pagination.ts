import { BaseRTO, IsNumber, IsString, Validation } from '@zanix/validator'

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

  /** Number of documents to return. */
  @IsNumber()
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
  /** Current page number (1-based). */
  @IsNumber()
  accessor page: number = 1

  /** Number of documents per page. */
  @IsNumber()
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
