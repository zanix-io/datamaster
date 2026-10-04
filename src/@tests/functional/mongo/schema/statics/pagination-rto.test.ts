import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { SearchPaginationRTO } from 'database/rtos/pagination.ts'
import { classValidation } from '@zanix/validator'
import { assertEquals, assertRejects } from '@std/assert'
import { Schema } from 'mongoose'

const newSchema = () => new Schema({ name: String, createdAt: Date })

Deno.test({
  ...sanitize,
  name:
    'SearchPaginationRTO -> Model.paginate: a query-string-shaped sortBy (string values) works end to end, without a Mongoose "Invalid sort value" error',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-pagination-rto-sort', newSchema())

    await new Model({ name: 'first', createdAt: new Date('2024-01-01') })
      .save()
    await new Model({ name: 'second', createdAt: new Date('2024-02-01') })
      .save()

    // Simulates what actually arrives from an HTTP query string: every value is a string,
    // e.g. `?sortBy[createdAt]=-1` — this is exactly the shape that used to throw
    // `TypeError: Invalid sort value: { createdAt: -1 }` when passed straight through unconverted.
    const dto = await classValidation(SearchPaginationRTO, {
      page: '1',
      limit: '10',
      sortBy: { createdAt: '-1' },
    })

    const { docs } = await Model.paginate({
      page: dto.page,
      limit: dto.limit,
      sort: dto.sortBy,
    })

    assertEquals(docs.map((d) => d.name), ['second', 'first'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'SearchPaginationRTO -> Model.paginate: an out-of-range limit/page is a validation error and a direct call never reads every document',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-pagination-rto-bounds', newSchema())

    await Promise.all([0, 1, 2, 3, 4].map((i) => new Model({ name: `doc-${i}` }).save()))

    const invalidQueries = [
      { limit: '0' },
      { limit: '-3' },
      { limit: '1.5' },
      { limit: 'abc' },
      {
        limit: '101',
      },
      { page: '0' },
      { page: '-2' },
    ]
    await Promise.all(
      invalidQueries.map((query) =>
        assertRejects(() => classValidation(SearchPaginationRTO, query))
      ),
    )

    // Without the RTO: nothing reaches MongoDB's `limit(0)` ("no limit") or a negative `skip`.
    await Promise.all(
      [{ limit: 0 }, { limit: -3 }, { page: 0 }, { page: -1 }].map((params) =>
        assertRejects(() => Model.paginate(params), Error, 'greater than or equal to 1')
      ),
    )
    await assertRejects(
      () => Model.paginateCursor({ limit: 0 }),
      Error,
      'greater than or equal to 1',
    )

    const edge = await classValidation(SearchPaginationRTO, { page: '1', limit: '1' })
    const { docs, totalPages } = await Model.paginate({ page: edge.page, limit: edge.limit })
    assertEquals(docs.length, 1)
    assertEquals(totalPages, 5)

    await DropCollection(Model, db)
    await db['close']()
  },
})
