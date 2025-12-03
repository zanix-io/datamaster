// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from '@std/assert'
import { paginate, paginateCursor } from 'mongo/processor/schema/statics/pagination.ts'

function createMockModel(data: any[]) {
  return {
    find(filter: any) {
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
