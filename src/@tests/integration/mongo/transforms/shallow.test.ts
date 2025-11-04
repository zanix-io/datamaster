// deno-lint-ignore-file no-explicit-any
import { transformShallowByPaths } from 'mongo/processor/schema/transforms/shallow.ts'
import { model, Schema } from 'mongoose'
import { assert, assertEquals } from '@std/assert'

let getterCalls = 0
const exampleSchema = (transform: (doc: any, ret: any) => any) => {
  const schema = new Schema({
    name: {
      type: String,
      get: (value: string) => {
        getterCalls++
        return `${value} (altered by get)`
      },
    },
    arr: [{
      type: String,
      get: function (value: any) {
        getterCalls++
        return `${value} (altered by get)`
      },
    }],
    arrayObject: [
      new Schema({
        value: {
          type: String,
          get: function (value: any) {
            getterCalls++
            return `${value} (altered by get)`
          },
        },
      }),
    ],
    mapObject: {
      type: Map,
      of: new Schema({
        value: {
          type: [String],
          get: function (value: any) {
            getterCalls++
            return value.map((v: any) => v + ' (altered by get)')
          },
        },
      }, {
        _id: false,
      }),
    },
  }, {
    toObject: {
      getters: false,
      virtuals: true,
      transform,
    },
    toJSON: {
      getters: false,
      virtuals: true,
      transform,
    },
  })

  return schema
}

const exampleData = {
  name: 'John Doe',
  nested: {
    subField: 'hello',
  },
  arrayObject: [{ value: 'array value' }, { value: 'array value 2' }],
  arr: ['arr value'],
  mapObject: {
    key1: { value: ['map value 1', 'd'] },
    key2: { value: ['map value 2'] },
  },
}

Deno.test('Nested transformations over predefined paths, calling all getters', () => {
  let calls = 0

  const ExampleModel = model(
    'Example-nested-tree-getters',
    exampleSchema((_, ret) =>
      transformShallowByPaths(ret, {
        deleteMetadata: true,
        allowedPaths: ['name', 'arrayObject.0.value', 'mapObject'],
        transform: (value) => {
          calls++
          if (typeof value === 'object') {
            value['key1']['value'] = value['key1']['value'] + ' (by transform)'
          } else value = value + ' (by transform)'
          return value
        },
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  getterCalls = 0
  const json = exampleDoc.toJSON({ getters: true, virtuals: false })
  assertEquals(getterCalls, 8)

  delete json.arrayObject[1]._id
  delete json['id' as never]

  assertEquals(json, {
    name: 'John Doe (altered by get) (by transform)',
    arr: ['arr value (altered by get)'],
    arrayObject: [
      {
        value: 'array value (altered by get) (by transform)',
      },
      {
        value: 'array value 2 (altered by get)',
      },
    ],
    mapObject: {
      key1: {
        value: 'map value 1 (altered by get),d (altered by get) (by transform)',
      },
      key2: {
        value: [
          'map value 2 (altered by get)',
        ],
      },
    },
  } as any)
  getterCalls = 0
})

Deno.test('Nested transformations over predefined paths', () => {
  let calls = 0
  getterCalls = 0

  const ExampleModel = model(
    'Example-nested-tree',
    exampleSchema((_, ret) =>
      transformShallowByPaths(ret, {
        deleteMetadata: true,
        allowedPaths: ['name', 'arrayObject.0.value', 'mapObject.*.value'],
        transform: (value) => {
          calls++
          if (Array.isArray(value)) return value.map((v) => v + ' (by transform)')
          return value + ' (by transform)'
        },
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  const doc: any = exampleDoc.toObject()

  assertEquals(calls, 4)
  assertEquals(getterCalls, 0) // No getters should be called because the { getter } option is false

  delete doc.arrayObject[1]._id
  delete doc['id' as never]
  doc.mapObject = JSON.parse(JSON.stringify(Object.fromEntries(doc.mapObject)))

  assertEquals(doc, {
    arr: exampleData.arr,
    name: 'John Doe (by transform)',
    arrayObject: [
      { value: 'array value (by transform)' },
      { value: 'array value 2' },
    ],
    mapObject: {
      key1: {
        value: ['map value 1 (by transform)', 'd (by transform)'],
      },
      key2: { value: ['map value 2 (by transform)'] },
    },
  } as any)

  const json = exampleDoc.toJSON()
  assertEquals(getterCalls, 0) // No getters should be called because the { getter } option is false
  delete json.arrayObject[1]._id
  delete json['id' as never]

  assertEquals(json, {
    arr: exampleData.arr,
    name: 'John Doe (by transform)',
    arrayObject: [
      { value: 'array value (by transform)' },
      { value: 'array value 2' },
    ],
    mapObject: {
      key1: {
        value: ['map value 1 (by transform) (by transform)', 'd (by transform) (by transform)'],
      },
      key2: { value: ['map value 2 (by transform) (by transform)'] },
    },
  } as any)

  assertEquals(exampleDoc.name, 'John Doe (altered by get)') // Should no include transforms

  getterCalls = 0
})

Deno.test('Nested transformations async', async () => {
  let calls = 0
  getterCalls = 0

  const ExampleModel = model(
    'Example-nested-tree-async',
    exampleSchema((_, ret) =>
      transformShallowByPaths(ret, {
        deleteMetadata: true,
        allowedPaths: ['name', 'arrayObject.0.value', 'mapObject.*.value'],
        transform: async function (value) {
          calls++
          await new Promise((resolve) => setTimeout(resolve, 300))
          if (Array.isArray(value)) return value.map((v) => v + ' (by transform)')

          return value + ' (by transform)'
        },
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  let json = exampleDoc.toJSON()
  assert(json instanceof Promise)

  json = await json
  delete json.arrayObject[1]._id
  delete json['id' as never]

  assertEquals(json, {
    arr: exampleData.arr,
    name: 'John Doe (by transform)',
    arrayObject: [
      { value: 'array value (by transform)' },
      { value: 'array value 2' },
    ],
    mapObject: {
      key1: {
        value: ['map value 1 (by transform)', 'd (by transform)'],
      },
      key2: { value: ['map value 2 (by transform)'] },
    },
  } as any)
  getterCalls = 0
})
