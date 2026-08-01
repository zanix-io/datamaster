import { assertEquals } from '@std/assert'
import { readDocuments } from 'mongo/processor/schema/statics/find.ts'
import { type Document, MockModel } from '../mocks.ts'

const mockDocs: Document[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Charlie' },
]

// Test
Deno.test('readDocuments should dispatch to readFind when mode is "find"', async () => {
  // deno-lint-ignore no-explicit-any
  const model = new MockModel(mockDocs) as any

  const calledDocs: { doc: Document; index: number }[] = []

  await readDocuments.call(model, {
    mode: 'find',
    filter: {},
    onDocument: (doc, i) => {
      calledDocs.push({ doc, index: i })
    },
  })

  assertEquals(calledDocs.length, 3)
  assertEquals(calledDocs[0].doc.name, 'Alice')
  assertEquals(calledDocs[2].doc.name, 'Charlie')
})

Deno.test('readDocuments should dispatch to readBatch when mode is "batch"', async () => {
  // deno-lint-ignore no-explicit-any
  const model = new MockModel(mockDocs) as any

  const calledDocs: { doc: Document; index: number }[] = []

  await readDocuments.call(model, {
    mode: 'batch',
    filter: {},
    batchSize: 1000,
    onDocument: (doc, i) => {
      calledDocs.push({ doc, index: i })
    },
  })

  assertEquals(calledDocs.length, 3)
  assertEquals(calledDocs[0].doc.name, 'Alice')
  assertEquals(calledDocs[2].doc.name, 'Charlie')
})

Deno.test('readDocuments should default to "cursor" mode when mode is not provided', async () => {
  // deno-lint-ignore no-explicit-any
  const model = new MockModel(mockDocs) as any

  const calledDocs: { doc: Document; index: number }[] = []

  await readDocuments.call(model, {
    filter: {},
    onDocument: (doc, i) => {
      calledDocs.push({ doc, index: i })
    },
  })

  assertEquals(calledDocs.length, 3)
  assertEquals(calledDocs[0].doc.name, 'Alice')
  assertEquals(calledDocs[2].doc.name, 'Charlie')
})
