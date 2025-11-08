import { assertEquals } from '@std/assert'
import { readBatch } from 'mongo/processor/schema/statics/find.ts'
import { type Document, MockModel } from '../mocks.ts'

// Test
Deno.test('readBatch should iterate until batch size and exec it onDocument', async () => {
  const mockDocs: Document[] = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ]

  // deno-lint-ignore no-explicit-any
  const model = new MockModel(mockDocs) as any

  const calledDocs: { doc: Document; index: number }[] = []

  await readBatch.call(model, {
    filter: {},
    limit: 2,
    batchSize: 1000,
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
