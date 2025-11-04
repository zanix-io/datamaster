// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../../_setup/mongo/connector.ts'
import { defineModelHOC } from 'modules/database/hocs/models.ts'
import { Schema } from 'mongoose'

export const extensionsSeeders = {
  seeders: [
    async (Model: any) => {
      const data = await Model.findById('68fb00b33405a3a540d9b971')
      if (data) return
      const acc = new Model({
        id: '68fb00b33405a3a540d9b971',
        name: 'test-seeder-1',
        description: 'description test seeder 1',
      })

      return acc.save()
    },
    async (Model: any) => {
      const data = await Model.findById('68fb00b33405a3a540d9b971')
      if (data) return
      const acc = new Model({
        id: '68fb00b33405a3a540d9b972',
        name: 'test-seeder-2',
        description: 'description test seeder not saved',
      })

      return acc.save()
    },
    async (Model: any) => {
      const data = await Model.findById('68fb00b33405a3a540d9b973')
      if (data) return
      const acc = new Model({
        id: '68fb00b33405a3a540d9b973',
        name: 'test-seeder-3',
        description: 'description test seeder 3',
      })

      return acc.save()
    },
  ],
}

const seedersValidation = async (Model: any, db: any) => {
  const [seeder1, seeder2, seeder3] = await Promise.all([
    Model.findById('68fb00b33405a3a540d9b971'),
    Model.findById('68fb00b33405a3a540d9b972'),
    Model.findById('68fb00b33405a3a540d9b973'),
  ])

  assert(!seeder2)
  assertEquals(seeder1?.name, 'test-seeder-1')
  assertEquals(seeder3?.name, 'test-seeder-3')

  // Drop collection
  await DropCollection(Model, db)
  await db['stopConnection']()
}

Deno.test({
  ...sanitize,
  name: 'Mongo connector should run seeders',
  fn: async () => {
    defineModelHOC({
      name: 'test-seeders',
      definition: {
        name: String,
        description: String,
      },
      extensions: {
        ...extensionsSeeders,
      },
    })

    const db = await getDB()
    const Model = db.getModel('test-seeders')

    await seedersValidation(Model, db)
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Mongo connector should run seeders with model by schema',
  fn: async () => {
    const schemaSeeders = new Schema({
      name: String,
      description: String,
    })

    const db = await getDB()
    const Model = await db.getModel('test-schema-seeders', schemaSeeders, {
      extensions: extensionsSeeders,
    })

    await seedersValidation(Model, db)
  },
  ignore,
})
