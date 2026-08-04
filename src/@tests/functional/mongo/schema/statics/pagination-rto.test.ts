import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { SearchPaginationRTO } from 'database/rtos/pagination.ts'
import { classValidation } from '@zanix/validator'
import { assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

const newSchema = () => new Schema({ name: String, createdAt: Date })

Deno.test({
  ...sanitize,
  name:
    'SearchPaginationRTO -> Model.paginate: a query-string-shaped sortBy (string values) works end to end, without a Mongoose "Invalid sort value" error',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-pagination-rto-sort', newSchema())

    await new Model({ name: 'first', createdAt: new Date('2024-01-01') }).save()
    await new Model({ name: 'second', createdAt: new Date('2024-02-01') }).save()

    // Simulates what actually arrives from an HTTP query string: every value is a string,
    // e.g. `?sortBy[createdAt]=-1` — this is exactly the shape that used to throw
    // `TypeError: Invalid sort value: { createdAt: -1 }` when passed straight through unconverted.
    const dto = await classValidation(SearchPaginationRTO, {
      page: '1',
      limit: '10',
      sortBy: { createdAt: '-1' },
    })

    const { docs } = await Model.paginate({ page: dto.page, limit: dto.limit, sort: dto.sortBy })

    assertEquals(docs.map((d) => d.name), ['second', 'first'])

    await DropCollection(Model, db)
    await db['close']()
  },
})
