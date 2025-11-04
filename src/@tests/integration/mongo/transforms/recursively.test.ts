// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from '@std/assert'
import { model, Schema } from 'mongoose'
import {
  transformDeepByPaths,
  transformRecursively,
} from 'mongo/processor/schema/transforms/recursively.ts'

// Example transform function to modify a value
const transformPrimitive = (value: any) => {
  if (typeof value === 'string') {
    return value.toUpperCase() // Example transformation: make string uppercase
  }

  if (typeof value === 'number') {
    return value * 2 // Example: double the number
  }

  return value // No transformation for other types
}

const transformNested = (ret: any, type: string) => {
  assert(type === 'array' || type === 'object')
  delete ret['_id']
  return ret
}

let getterCalled = 0

const exampleSchema = (transform: (doc: any, ret: any) => any) =>
  new Schema({
    name: String,
    age: Number,
    nested: {
      type: Schema.Types.Mixed,
      default: {},
    },
    tags: [String],
    metadata: {
      type: Map,
      of: String,
    },
    profile: new Schema({
      phone: { type: String },
      email: { type: String },
      addresses: [String],
      metadata: {
        type: Map,
        of: new Schema({
          type: String,
          value: [
            new Schema({
              key: {
                type: String,
                get: (v: any) => {
                  getterCalled++
                  return v + ' (adapted by get)'
                },
              },
              symbol: Number,
            }),
          ],
        }),
      },
    }),
  }, {
    toJSON: {
      virtuals: true,
      transform,
    },
    toObject: {
      virtuals: true,
      transform,
    },
  })

const exampleData = {
  name: 'John Doe',
  age: 30,
  nested: {
    subField: 'hello',
  },
  tags: ['tag1', 'tag2'],
  metadata: new Map([['key1', 'value1'], ['key2', 'value2']]),
  profile: {
    phone: 'Pepito Perez',
    email: 'email@email.com',
    addresses: ['Av 1 Cl 2', 'Av 1 Cl 3'],
    metadata: {
      key1: {
        type: 'profile key1',
        value: [{ key: 'key1', symbol: 2 }, { key: 'key2', symbol: 2 }, { key: 'key3', symbol: 3 }],
      },
      key2: { type: 'profile key1', value: [{ key: 'key1', symbol: 2 }] },
    },
  },
}

const wildcardValidation = (exampleDoc: any, isObject?: boolean) => {
  assertEquals(exampleDoc.name, exampleData.name)
  assertEquals(exampleDoc.age, exampleData.age)
  assertEquals(exampleDoc.nested, exampleData.nested)
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key1') : exampleDoc.metadata.key1,
    transformPrimitive(exampleData.metadata.get('key1')),
  )
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key2') : exampleDoc.metadata.key2,
    transformPrimitive(exampleData.metadata.get('key2')),
  )
  assertEquals(exampleDoc.tags, [
    transformPrimitive(exampleData.tags[0]),
    transformPrimitive(exampleData.tags[1]),
  ])

  assertEquals(exampleDoc.profile.phone, exampleData.profile.phone)
  assertEquals(exampleDoc.profile.email, exampleData.profile.email)
  assertEquals(exampleDoc.profile.addresses[0], exampleData.profile.addresses[0])
  assertEquals(
    exampleDoc.profile.addresses[1],
    transformPrimitive(exampleData.profile.addresses[1]),
  )

  assert(exampleDoc.profile._id)

  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.type
      : exampleDoc.profile?.metadata?.key1?.type,
    exampleData.profile.metadata.key1.type,
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.type
      : exampleDoc.profile?.metadata?.key2?.type,
    exampleData.profile.metadata.key1.type,
  )

  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[0].key
      : exampleDoc.profile?.metadata?.key1?.value[0].key,
    transformPrimitive(exampleData.profile.metadata.key1.value[0].key) +
      (isObject ? ' (adapted by get)' : ''),
  )

  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[0].symbol
      : exampleDoc.profile?.metadata?.key1?.value[0].symbol,
    exampleData.profile.metadata.key1.value[0].symbol,
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[1].key
      : exampleDoc.profile?.metadata?.key1?.value[1].key,
    exampleData.profile.metadata.key1.value[1].key + (isObject ? ' (adapted by get)' : ''),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[1].symbol
      : exampleDoc.profile?.metadata?.key1?.value[1].symbol,
    exampleData.profile.metadata.key1.value[1].symbol,
  )

  if (!isObject) {
    assert(!exampleDoc.profile?.metadata?.key1?.value[2]._id)
    assert(!exampleDoc.profile?.metadata?.key2?.value[2]?._id)
  }

  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.value[0].key
      : exampleDoc.profile?.metadata?.key2?.value[0].key,
    transformPrimitive(exampleData.profile.metadata.key2.value[0].key) +
      (isObject ? ' (adapted by get)' : ''),
  )

  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.value[0].symbol
      : exampleDoc.profile?.metadata?.key2?.value[0].symbol,
    exampleData.profile.metadata.key2.value[0].symbol,
  )
}

const fullProfileValidation = (exampleDoc: any, isObject?: boolean) => {
  assert(!exampleDoc.profile._id)
  assertEquals(
    exampleDoc.profile?.phone,
    transformPrimitive(exampleData.profile.phone),
  )
  assertEquals(
    exampleDoc.profile?.email,
    transformPrimitive(exampleData.profile.email),
  )
  assertEquals(
    exampleDoc.profile?.addresses,
    [
      transformPrimitive(exampleData.profile.addresses[0]),
      transformPrimitive(exampleData.profile.addresses[1]),
    ],
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.type
      : exampleDoc.profile?.metadata?.key1?.type,
    transformPrimitive(exampleData.profile.metadata.key1.type),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.type
      : exampleDoc.profile?.metadata?.key2?.type,
    transformPrimitive(exampleData.profile.metadata.key1.type),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[0].key
      : exampleDoc.profile?.metadata?.key1?.value[0].key,
    transformPrimitive(exampleData.profile.metadata.key1.value[0].key),
  )
  assert(
    !(
      isObject
        ? exampleDoc.profile?.metadata?.get('key1')?.value[0]._id
        : exampleDoc.profile?.metadata?.key1?.value[0]._id
    ),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[0].symbol
      : exampleDoc.profile?.metadata?.key1?.value[0].symbol,
    transformPrimitive(exampleData.profile.metadata.key1.value[0].symbol),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[1].key
      : exampleDoc.profile?.metadata?.key1?.value[1].key,
    transformPrimitive(exampleData.profile.metadata.key1.value[1].key),
  )
  assert(
    !(
      isObject
        ? exampleDoc.profile?.metadata?.get('key1')?.value[1]._id
        : exampleDoc.profile?.metadata?.key1?.value[1]._id
    ),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key1')?.value[1].symbol
      : exampleDoc.profile?.metadata?.key1?.value[1].symbol,
    transformPrimitive(exampleData.profile.metadata.key1.value[1].symbol),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.value[0].key
      : exampleDoc.profile?.metadata?.key2?.value[0].key,
    transformPrimitive(exampleData.profile.metadata.key2.value[0].key),
  )
  assert(
    !(
      isObject
        ? exampleDoc.profile?.metadata?.get('key2')?.value[0]._id
        : exampleDoc.profile?.metadata?.key2?.value[0]._id
    ),
  )
  assertEquals(
    isObject
      ? exampleDoc.profile?.metadata?.get('key2')?.value[0].symbol
      : exampleDoc.profile?.metadata?.key2?.value[0].symbol,
    transformPrimitive(exampleData.profile.metadata.key2.value[0].symbol),
  )
}

const specifiedPathValidations = (exampleDoc: any, isObject?: boolean) => {
  assertEquals(exampleDoc.name, transformPrimitive(exampleData.name))
  assertEquals(exampleDoc.age, exampleData.age)
  assertEquals(exampleDoc.nested.subField, transformPrimitive(exampleData.nested.subField))
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key1') : exampleDoc.metadata.key1,
    transformPrimitive(exampleData.metadata.get('key1')),
  )
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key2') : exampleDoc.metadata.key2,
    exampleData.metadata.get('key2'),
  )
  assertEquals(exampleDoc.tags[0], exampleData.tags[0])
  assertEquals(exampleDoc.tags[1], transformPrimitive(exampleData.tags[1]))

  fullProfileValidation(exampleDoc, isObject)
}

const fullPathValidations = (exampleDoc: any, isObject?: boolean) => {
  assert(!exampleDoc._id)
  assertEquals(exampleDoc.name, transformPrimitive(exampleData.name))
  assertEquals(exampleDoc.nested.subField, transformPrimitive(exampleData.nested.subField))
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key1') : exampleDoc.metadata.key1,
    transformPrimitive(exampleData.metadata.get('key1')),
  )
  assertEquals(exampleDoc.age, transformPrimitive(exampleData.age))
  assertEquals(exampleDoc.tags, [
    transformPrimitive(exampleData.tags[0]),
    transformPrimitive(exampleData.tags[1]),
  ])
  assertEquals(
    isObject ? exampleDoc.metadata?.get('key2') : exampleDoc.metadata.key2,
    transformPrimitive(exampleData.metadata.get('key2')),
  )
  fullProfileValidation(exampleDoc, isObject)
}

Deno.test('Nested transform to all tree', () => {
  const ExampleModel = model(
    'Example-1',
    exampleSchema((_, ret) =>
      transformRecursively(ret, {
        deleteMetadata: true,
        transformPrimitive,
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  fullPathValidations(exampleDoc.toObject(), true)
  fullPathValidations(exampleDoc.toJSON())
})

Deno.test('Nested transform to specified paths', () => {
  const ExampleModel = model(
    'Example-2',
    exampleSchema((_, ret) =>
      transformDeepByPaths(ret, {
        transformPrimitive,
        transformNested,
        allowedPaths: [
          'name',
          'metadata.key1',
          'profile',
          'tags.1',
          'nested.subField',
        ],
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  specifiedPathValidations(exampleDoc.toObject(), true)
  specifiedPathValidations(exampleDoc.toJSON())
})

Deno.test('Nested transform to specified paths with wildcard', () => {
  const ExampleModel = model(
    'Example-3',
    exampleSchema((_, ret) =>
      transformDeepByPaths(ret, {
        transformPrimitive,
        transformNested,
        allowedPaths: [
          'metadata.*',
          'profile.metadata.*.value.0.key',
          'profile.metadata.*.value.2.*',
          'profile.addresses.1',
          'tags.*',
        ],
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  wildcardValidation(exampleDoc.toObject(), true)
  wildcardValidation(exampleDoc.toJSON())
})

Deno.test('Nested transform recursively, should not call getters', () => {
  const ExampleModel = model(
    'Example-4',
    exampleSchema((_, ret) =>
      transformRecursively(ret, {
        transformPrimitive,
        transformNested,
      })
    ),
  )

  // Simulating a document
  const exampleDoc = new ExampleModel(exampleData)

  getterCalled = 0
  exampleDoc.toObject()
  exampleDoc.toJSON()
  assertEquals(getterCalled, 0)

  const ExampleModel2 = model(
    'Example-5',
    exampleSchema((_, ret) =>
      transformDeepByPaths(ret, {
        transformPrimitive,
        transformNested,
        allowedPaths: [
          'metadata.*',
          'profile.metadata.*.value.0.key',
          'profile.metadata.*.value.2.*',
          'profile.addresses.1',
          'tags',
        ],
      })
    ),
  )

  // Simulating a document
  const exampleDoc2 = new ExampleModel2(exampleData)

  getterCalled = 0
  exampleDoc2.toObject()
  exampleDoc2.toJSON()
  assertEquals(getterCalled, 0)
})
