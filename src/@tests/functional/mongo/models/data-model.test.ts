// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertThrows } from '@std/assert'
import { DropCollection, getDB, ignore, Mongo, sanitize } from '../../../(setup)/mongo/connector.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { seedByIdIfMissing } from 'mongo/utils/seeders.ts'
import { Schema } from 'mongoose'

console.error = () => {}

const modelValidation = async (Model: any, db: any) => {
  // Test schema methods
  assertEquals(Model.schema.methods.myFirstMethod(), 'my first value')
  assertEquals(Model.schema.methods.myMethod(), 'my value')

  // Save and find data
  const instance = await new Model({ description: 'my description', name: 'my name' }).save()

  const data = await Model.findById(instance.id)

  assertEquals(data?.name, 'my name')

  await Model.findByIdAndDelete(instance)

  // Drop collection
  await DropCollection(Model, db)

  await db['close']()
}

Deno.test({
  ...sanitize,
  name: 'Mongo connector should add DSL model',
  fn: async () => {
    type Attrs = {
      name?: string
      description?: string
    }

    registerModel<Attrs>({
      name: 'test-basic-get-model',
      definition: { name: String, description: String },
      options: { methods: { myFirstMethod: () => 'my first value' } },
      extensions: { seeders: [function seeder() {}] },
      callback: (schema) => {
        schema.methods.myMethod = () => 'my value'
        return schema
      },
    })

    const db = await getDB()
    const Model = db.getModel<Attrs>('test-basic-get-model')

    await modelValidation(Model, db)
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Mongo connector should add model by schema',
  fn: async () => {
    const schema = new Schema({ name: String, description: String }, {
      methods: { myFirstMethod: () => 'my first value' },
    })
    schema.methods.myMethod = () => 'my value'

    const db = await getDB()
    const Model = db.getModel('test-by-schema-get-model', schema)
    await modelValidation(Model, db)
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Mongo connector should disponibilize model before initialize connection',
  fn: async () => {
    const schema = new Schema({ name: String, description: String }, {
      methods: { myFirstMethod: () => 'my first value' },
    })
    schema.methods.myMethod = () => 'my value'

    const db = new Mongo()
    const Model = db.getModel('test-by-schema-get-model', schema)
    await db.isReady
    await modelValidation(Model, db)
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Mongo connector should manage multiple related databases',
  fn: async () => {
    registerModel({
      name: 'zanix-related-database-test:test-user-related-model',
      definition: { name: String },
      extensions: {
        seeders: [seedByIdIfMissing({ id: '6920b48c72b6b185da32823b', name: 'my user name' })],
      },
    })

    registerModel({
      name: 'test-basic-related-model',
      definition: {
        related: {
          type: Schema.Types.ObjectId,
          ref: 'zanix-related-database-test:test-user-related-model',
        },
      },
      extensions: {
        seeders: [
          seedByIdIfMissing({
            id: '6920b48c72b6b185da32823c',
            related: '6920b48c72b6b185da32823b',
          }),
        ],
      },
    })

    const db = await getDB()
    let Model = db.getModel('test-basic-related-model')

    let user = await Model.findById('6920b48c72b6b185da32823c').populate('related') // query populate

    assertEquals(user?.related.name, 'my user name')

    await DropCollection(Model, db)

    Model = db.getModel('zanix-related-database-test:test-user-related-model')

    user = await Model.findById('6920b48c72b6b185da32823b')

    assertEquals(user?.name, 'my user name')

    await DropCollection(Model, db)

    assertThrows(() => db.getModel('test-user-related-model'))

    await db['close']()
  },
  ignore,
})
