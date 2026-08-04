import { assert, assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { ScrollPaginationRTO, SearchPaginationRTO } from 'database/rtos/pagination.ts'

Deno.test('SearchPaginationRTO: applies page/limit defaults when omitted', async () => {
  const dto = await classValidation(SearchPaginationRTO, {})

  assertEquals(dto.page, 1)
  assertEquals(dto.limit, 10)
  assertEquals(dto.sortBy, undefined)
})

Deno.test(
  'SearchPaginationRTO: coerces sortBy string values (as a real query string sends them) to numbers',
  async () => {
    const dto = await classValidation(SearchPaginationRTO, {
      page: 2,
      limit: 20,
      sortBy: { createdAt: '-1', name: '1' },
    })

    assertEquals(dto.sortBy, { createdAt: -1, name: 1 })
    // Not just equal — actually numbers, not the numeric strings a query string sends.
    assert(typeof dto.sortBy?.createdAt === 'number')
  },
)

Deno.test('SearchPaginationRTO: accepts sortBy values that are already real numbers', async () => {
  const dto = await classValidation(SearchPaginationRTO, { sortBy: { createdAt: -1 } })

  assertEquals(dto.sortBy, { createdAt: -1 })
})

Deno.test('SearchPaginationRTO: rejects a sortBy value outside of 1/-1', async () => {
  await assertRejects(() => classValidation(SearchPaginationRTO, { sortBy: { createdAt: '5' } }))
})

Deno.test('SearchPaginationRTO: rejects a non-object sortBy', async () => {
  await assertRejects(() => classValidation(SearchPaginationRTO, { sortBy: 'createdAt' }))
})

Deno.test(
  'ScrollPaginationRTO: applies the limit default and leaves cursor undefined',
  async () => {
    const dto = await classValidation(ScrollPaginationRTO, {})

    assertEquals(dto.limit, 10)
    assertEquals(dto.cursor, undefined)
  },
)

Deno.test('ScrollPaginationRTO: accepts an explicit cursor', async () => {
  const dto = await classValidation(ScrollPaginationRTO, {
    cursor: '507f191e810c19729de860ea',
    limit: 25,
  })

  assertEquals(dto.cursor, '507f191e810c19729de860ea')
  assertEquals(dto.limit, 25)
})
