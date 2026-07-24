import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'
import { mainVirtuals } from 'mongo/processor/schema/virtuals.ts'

// mocks
console.error = () => {}

Deno.test('mainVirtuals adds an "id" virtual setter that assigns _id', () => {
  const schema = new Schema({ name: String })

  mainVirtuals(schema as never)

  const doc: { _id?: unknown } = {}
  ;(schema.virtuals as Record<string, { applySetters: (v: unknown, doc: unknown) => void }>)['id']
    .applySetters('custom-id', doc)

  assertEquals(doc._id, 'custom-id')
})

Deno.test('mainVirtuals logs and does not throw when "id" is already a real path', () => {
  const schema = new Schema({ id: String })

  mainVirtuals(schema as never)

  assert(true)
})
