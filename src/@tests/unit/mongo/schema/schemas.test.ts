import { Schema } from 'mongoose'
import { getAllSubschemas } from 'mongo/utils/schemas.ts'
import { assertEquals } from '@std/assert'

Deno.test('getAllSubschemas returns empty array when schema has no subschemas', () => {
  const schema = new Schema({ name: String, age: Number })

  const result = getAllSubschemas(schema)

  assertEquals(result, [])
})

Deno.test('getAllSubschemas collects direct embedded subdocuments', () => {
  const addressSchema = new Schema({ city: String })
  const schema = new Schema({ address: addressSchema })

  const result = getAllSubschemas(schema)

  assertEquals(result.length, 1)
  assertEquals(result[0].path, 'address')
  assertEquals(result[0].schema, addressSchema)
})

Deno.test('getAllSubschemas collects subdocuments nested inside arrays', () => {
  const itemSchema = new Schema({ sku: String })
  const schema = new Schema({ items: [itemSchema] })

  const result = getAllSubschemas(schema)

  assertEquals(result.length, 1)
  assertEquals(result[0].path, 'items')
  assertEquals(result[0].schema, itemSchema)
})

Deno.test('getAllSubschemas recurses into nested subschemas and builds dot-notated paths', () => {
  const deepSchema = new Schema({ value: String })
  const childSchema = new Schema({ deep: deepSchema })
  const schema = new Schema({ parent: childSchema })

  const result = getAllSubschemas(schema)

  assertEquals(result.map((s) => s.path), ['parent', 'parent.deep'])
  assertEquals(result[1].schema, deepSchema)
})

Deno.test('getAllSubschemas collects subdocuments nested inside a Map', () => {
  const entrySchema = new Schema({ label: String })
  const schema = new Schema({ entries: { type: Map, of: entrySchema } })

  const result = getAllSubschemas(schema)

  assertEquals(result.length, 1)
  assertEquals(result[0].path, 'entries.$*')
  assertEquals(result[0].schema, entrySchema)
})

Deno.test('getAllSubschemas collects subdocuments nested inside an array of arrays', () => {
  const itemSchema = new Schema({ sku: String })
  const schema = new Schema({ matrix: [[itemSchema]] })

  const result = getAllSubschemas(schema)

  assertEquals(result.length, 1)
  assertEquals(result[0].path, 'matrix')
  assertEquals(result[0].schema, itemSchema)
})
