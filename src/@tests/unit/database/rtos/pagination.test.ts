import { assert, assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { PageLimit, ScrollPaginationRTO, SearchPaginationRTO } from 'database/rtos/pagination.ts'
import { MAX_PAGE_LIMIT } from 'database/utils/pagination.ts'

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
  const dto = await classValidation(SearchPaginationRTO, {
    sortBy: { createdAt: -1 },
  })

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

/** Runs the RTO validation and returns the 400's status value plus the field's failed constraints. */
const rejected = async (rto: typeof SearchPaginationRTO, data: object, field: string) => {
  const error = await assertRejects(() => classValidation(rto, data)) as {
    status?: { value: number }
    cause?: { properties?: Record<string, { constraints: string[] }[]> }
  }
  const constraints = error.cause?.properties?.[field]?.flatMap((p) => p.constraints) ?? []
  return { status: error.status?.value, constraints }
}

for (
  const limit of [
    '0',
    0,
    '-3',
    -3,
    '2.5',
    2.5,
    'abc',
    '',
    ' ',
    'NaN',
    NaN,
    Infinity,
    '1e2',
    `${MAX_PAGE_LIMIT + 1}`,
    100000,
    [],
    {},
  ]
) {
  Deno.test(`SearchPaginationRTO: rejects limit ${JSON.stringify(limit) ?? String(limit)} with a validation error`, async () => {
    const { status, constraints } = await rejected(SearchPaginationRTO, { limit }, 'limit')
    assertEquals(status, 400)
    assertEquals(constraints, [`'limit' must be an integer between 1 and ${MAX_PAGE_LIMIT}.`])
  })

  Deno.test(`ScrollPaginationRTO: rejects limit ${JSON.stringify(limit) ?? String(limit)} with a validation error`, async () => {
    const { status, constraints } = await rejected(
      ScrollPaginationRTO as unknown as typeof SearchPaginationRTO,
      { limit },
      'limit',
    )
    assertEquals(status, 400)
    assertEquals(constraints.length, 1)
  })
}

for (const page of ['0', 0, '-1', -1, '1.5', 1.5, 'abc', '', NaN, Infinity, []]) {
  Deno.test(`SearchPaginationRTO: rejects page ${JSON.stringify(page) ?? String(page)} with a validation error`, async () => {
    const { status, constraints } = await rejected(SearchPaginationRTO, { page }, 'page')
    assertEquals(status, 400)
    assertEquals(constraints, ["'page' must be an integer greater than or equal to 1."])
  })
}

Deno.test('SearchPaginationRTO: rejection is a 400 validation error, never a server error', async () => {
  const { status } = await rejected(SearchPaginationRTO, { limit: '0', page: '0' }, 'limit')
  assertEquals(status, 400)
})

Deno.test('SearchPaginationRTO: accepts the range edges, as numbers and as query-string text', async () => {
  const cases = [
    [1, 1],
    ['1', '1'],
    [2, MAX_PAGE_LIMIT],
    ['9999', `${MAX_PAGE_LIMIT}`],
    [' 3 ', ' 7 '],
    ['2.0', '5.0'],
  ]
  const dtos = await Promise.all(
    cases.map(([page, limit]) => classValidation(SearchPaginationRTO, { page, limit })),
  )
  dtos.forEach((dto, i) => {
    const [page, limit] = cases[i]
    assertEquals(typeof dto.page, 'number')
    assertEquals(typeof dto.limit, 'number')
    assertEquals(dto.page, Number(String(page).trim()))
    assertEquals(dto.limit, Number(String(limit).trim()))
  })
})

Deno.test('ScrollPaginationRTO: accepts limit 1 and the maximum, from query-string text', async () => {
  assertEquals((await classValidation(ScrollPaginationRTO, { limit: '1' })).limit, 1)
  assertEquals(
    (await classValidation(ScrollPaginationRTO, { limit: `${MAX_PAGE_LIMIT}` })).limit,
    MAX_PAGE_LIMIT,
  )
})

Deno.test('MAX_PAGE_LIMIT: defaults to 100', () => {
  assertEquals(MAX_PAGE_LIMIT, 100)
})

Deno.test('PageLimit(max): a subclass redeclaring the accessor gets its own bound', async () => {
  class BulkSearchRTO extends SearchPaginationRTO {
    @PageLimit(500)
    override accessor limit: number = 50
  }

  assertEquals((await classValidation(BulkSearchRTO, {})).limit, 50)
  assertEquals((await classValidation(BulkSearchRTO, { limit: '500' })).limit, 500)
  await assertRejects(() => classValidation(BulkSearchRTO, { limit: '501' }))
  await assertRejects(() => classValidation(BulkSearchRTO, { limit: '0' }))
  // The base class keeps its own default bound.
  await assertRejects(() => classValidation(SearchPaginationRTO, { limit: '500' }))
})
