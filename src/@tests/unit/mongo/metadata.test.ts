import { assertEquals } from '@std/assert'
import {
  transformClearAllMetadata,
  transformClearIdMetadata,
} from 'mongo/processor/schema/transforms/metadata.ts'

Deno.test('transformClearIdMetadata removes the _id field', () => {
  const ret: Record<string, unknown> = { _id: '123', name: 'John' }

  transformClearIdMetadata({} as never, ret)

  assertEquals(ret, { name: 'John' })
})

Deno.test('transformClearAllMetadata removes _id and __v fields', () => {
  const ret: Record<string, unknown> = { _id: '123', name: 'John', __v: 0 }

  transformClearAllMetadata({} as never, ret)

  assertEquals(ret, { name: 'John' })
})
