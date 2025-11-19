// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { Schema } from 'mongoose'

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
      definition: {
        name: String,
        description: String,
      },
      options: {
        methods: {
          myFirstMethod: () => 'my first value',
        },
      },
      extensions: {
        seeders: [function seeder() {}],
      },
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
    const schema = new Schema({
      name: String,
      description: String,
    }, {
      methods: {
        myFirstMethod: () => 'my first value',
      },
    })
    schema.methods.myMethod = () => 'my value'

    const db = await getDB()
    const Model = await db.getModel('test-by-schema-get-model', schema)
    await modelValidation(Model, db)
  },
  ignore,
})
