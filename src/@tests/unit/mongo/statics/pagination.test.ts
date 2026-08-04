// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from '@std/assert'
import { paginate, paginateCursor } from 'mongo/processor/schema/statics/pagination.ts'

function createMockModel(data: any[], { capturedFilters }: { capturedFilters?: any[] } = {}) {
  return {
    find(filter: any) {
      capturedFilters?.push(filter)

      // Apply basic filtering with exact match or $gt operator
      let result = data.filter((d) => {
        for (const k in filter) {
          if (typeof filter[k] === 'object' && filter[k].$gt) {
            if (!(d[k] > filter[k].$gt)) return false
          } else if (d[k] !== filter[k]) return false
        }
        return true
      })

      const api = {
        sort(_: any) {
          // Sorting is ignored for simplicity, but the chain is preserved
          return api
        },
        skip(n: number) {
          result = result.slice(n)
          return api
        },
        limit(n: number) {
          result = result.slice(0, n)
          return api
        },
        select(_: string) {
          // Projection is not implemented in detail; returned as-is
          return Promise.resolve(result)
        },
      }
      return api
    },

    countDocuments(filter: any) {
      capturedFilters?.push(filter)

      // Counts items matching the filter
      return Promise.resolve(
        data.filter((d) => {
          for (const k in filter) {
            if (d[k] !== filter[k]) return false
          }
          return true
        }).length,
      )
    },

    // Mocked to return a fixed, recognizable shape — this file only tests how `paginate`/
    // `paginateCursor` combine `search`'s result with `filter`, not the real search-building logic
    // (that's `buildSearchFilter`'s own functional test suite).
    buildSearchFilter(query: string | undefined, fields: string[], conditions?: any) {
      if (!query) return { ...conditions }
      return { ...conditions, $or: fields.map((f) => ({ [f]: { $regex: query } })) }
    },
  }
}

Deno.test('paginate: funciona correctamente con datos simples', async () => {
  const model = createMockModel([
    { _id: 1, name: 'A' },
    { _id: 2, name: 'B' },
    { _id: 3, name: 'C' },
  ])

  const result = await paginate.call(model as any, {
    page: 1,
    limit: 2,
  })

  assertEquals(result.docs.length, 2)
  assertEquals(result.total, 3)
  assertEquals(result.totalPages, 2)
  assertEquals(result.hasNextPage, true)
  assertEquals(result.hasPrevPage, false)
})

Deno.test('paginate: works correctly with basic data', async () => {
  const model = createMockModel([
    { _id: 1, name: 'A' },
    { _id: 2, name: 'B' },
    { _id: 3, name: 'C' },
  ])

  const result = await paginate.call(model as any, {
    page: 1,
    limit: 2,
  })

  assertEquals(result.docs.length, 2)
  assertEquals(result.total, 3)
  assertEquals(result.totalPages, 2)
  assertEquals(result.hasNextPage, true)
  assertEquals(result.hasPrevPage, false)
})

Deno.test('paginate: page 2 returns correct results', async () => {
  const model = createMockModel([
    { _id: 1 },
    { _id: 2 },
    { _id: 3 },
  ])

  const result = await paginate.call(model as any, {
    page: 2,
    limit: 2,
  })

  assertEquals(result.docs.length, 1)
  assertEquals(result.page, 2)
  assertEquals(result.hasNextPage, false)
  assertEquals(result.hasPrevPage, true)
})

Deno.test('paginate: applies an omit projection when provided', async () => {
  const model = createMockModel([
    { _id: 1, name: 'A' },
    { _id: 2, name: 'B' },
  ])

  const result = await paginate.call(model as any, {
    page: 1,
    limit: 2,
    omit: ['name'],
  })

  assertEquals(result.docs.length, 2)
})

Deno.test('paginateCursor: applies an omit projection when provided', async () => {
  const model = createMockModel([
    { _id: 1, name: 'A' },
    { _id: 2, name: 'B' },
  ])

  const result = await paginateCursor.call(model as any, {
    limit: 2,
    omit: ['name'],
  })

  assertEquals(result.docs.length, 2)
})

Deno.test('paginateCursor: returns first page with nextCursor', async () => {
  const model = createMockModel([
    { _id: 1, x: 1 },
    { _id: 2, x: 2 },
    { _id: 3, x: 3 },
  ])

  const result = await paginateCursor.call(model as any, {
    limit: 2,
  })

  assertEquals(result.docs.length, 2)
  assert(result.hasNextPage)
  assertEquals(result.nextCursor, 2 as never)
})

Deno.test('paginateCursor: returns second page using cursor', async () => {
  const model = createMockModel([
    { _id: 1 },
    { _id: 2 },
    { _id: 3 },
  ])

  // First page
  const first = await paginateCursor.call(model as any, { limit: 2 })

  // Second page using the cursor from the previous call
  const second = await paginateCursor.call(model as any, {
    limit: 2,
    cursor: first.nextCursor,
  })

  assertEquals(second.docs.length, 1)
  assertEquals(second.hasNextPage, false)
  assertEquals(second.nextCursor, null)
})

Deno.test(
  'paginate: search alone (no filter) is used as-is, without extra $and nesting',
  async () => {
    const captured: any[] = []
    const model = createMockModel([{ _id: 1, name: 'A' }], { capturedFilters: captured })

    await paginate.call(model as any, { search: { query: 'a', fields: ['name'] } })

    assertEquals(captured[0], { $or: [{ name: { $regex: 'a' } }] })
  },
)

Deno.test(
  'paginate: search combined with a non-empty filter wraps both in $and, never merging top-level keys',
  async () => {
    const captured: any[] = []
    const model = createMockModel([{ _id: 1, name: 'A', status: 'active' }], {
      capturedFilters: captured,
    })

    await paginate.call(model as any, {
      filter: { status: 'active' },
      search: { query: 'a', fields: ['name'] },
    })

    assertEquals(captured[0], {
      $and: [{ $or: [{ name: { $regex: 'a' } }] }, { status: 'active' }],
    })
    // Both the `find` and the `countDocuments` calls must receive the same combined shape.
    assertEquals(captured[1], captured[0])
  },
)

Deno.test(
  'paginate: an empty search query is a no-op — the plain filter is used untouched',
  async () => {
    const captured: any[] = []
    const model = createMockModel([{ _id: 1, status: 'active' }], { capturedFilters: captured })

    await paginate.call(model as any, {
      filter: { status: 'active' },
      search: { query: '', fields: ['name'] },
    })

    assertEquals(captured[0], { status: 'active' })
  },
)

Deno.test('paginateCursor: search combined with filter wraps both in $and', async () => {
  const captured: any[] = []
  const model = createMockModel([{ _id: 1, name: 'A', status: 'active' }], {
    capturedFilters: captured,
  })

  await paginateCursor.call(model as any, {
    filter: { status: 'active' },
    search: { query: 'a', fields: ['name'] },
  })

  assertEquals(captured[0], {
    $and: [{ $or: [{ name: { $regex: 'a' } }] }, { status: 'active' }],
  })
})
