import { assertEquals } from '@std/assert'
import { readCursor } from 'mongo/processor/schema/statics/find.ts'
import { type Document, MockModel } from '../mocks.ts'

// Test
Deno.test('readCursor should iterate over cursor and exec it onDocument', async () => {
  const mockDocs: Document[] = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ]

  // deno-lint-ignore no-explicit-any
  const model = new MockModel(mockDocs) as any

  const calledDocs: { doc: Document; index: number }[] = []

  await readCursor.call(model, {
    filter: {},
    limit: 2,
    useLean: true,
    onDocument: (doc, i) => {
      calledDocs.push({ doc, index: i })
    },
  })

  assertEquals(calledDocs.length, 2)
  assertEquals(calledDocs[0].doc.name, 'Alice')
  assertEquals(calledDocs[0].index, 1)
  assertEquals(calledDocs[1].doc.name, 'Bob')
  assertEquals(calledDocs[1].index, 2)
})
