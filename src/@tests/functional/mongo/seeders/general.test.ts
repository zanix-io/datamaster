// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { seedByIdIfMissing, seedManyByIdIfMissing } from 'mongo/utils/seeders.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { Schema } from 'mongoose'

const bulk = [
  {
    id: '68fb00b33405a3a540d9b971',
    name: 'test-seeder-1',
    description: 'description test seeder 1',
  },
  {
    id: '68fb00b33405a3a540d9b972',
    name: 'test-seeder-2',
    description: 'description test seeder not saved',
  },
  {
    id: '68fb00b33405a3a540d9b973',
    name: 'test-seeder-3',
    description: 'description test seeder 3',
  },
]
export const extensionsSeeders = {
  seeders: [
    async function SeedOne(Model: any) {
      const data = await Model.findById(bulk[0].id)
      if (data) return
      const acc = new Model(bulk[0])

      return acc.save()
    },
    async function SeedTwo(Model: any) {
      const data = await Model.findById(bulk[0].id)
      if (data) return
      const acc = new Model(bulk[1])

      return acc.save()
    },
    async function SeedThree(Model: any) {
      const data = await Model.findById(bulk[2].id)
      if (data) return
      const acc = new Model(bulk[2])

      return acc.save()
    },
  ],
}

const closeConnection = async (Model: any, db: any) => {
  // Drop collection
  await Model.deleteMany({ _id: { $in: [bulk[0].id, bulk[1].id, bulk[2].id] } })
  await DropCollection(Model, db)
  await db['close']()
}

const seedersValidation = async (Model: any, db: any) => {
  const [seeder1, seeder2, seeder3] = await Promise.all([
    Model.findById(bulk[0].id),
    Model.findById(bulk[1].id),
    Model.findById(bulk[2].id),
  ])

  assert(!seeder2)
  assertEquals(seeder1?.name, bulk[0].name)
  assertEquals(seeder3?.name, bulk[2].name)

  // Drop collection
  await closeConnection(Model, db)
}

Deno.test({
  ...sanitize,
  name: 'Mongo connector should run seeders',
  fn: async () => {
    registerModel({
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

    await new Promise((resolve) => {
      db.getModel('test-schema-seeders', schemaSeeders, {
        extensions: extensionsSeeders,
        callback: async (Model) => {
          await seedersValidation(Model, db)
          resolve(true)
        },
      })
    })
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Mongo connector should run customized seeders',
  fn: async () => {
    registerModel({
      name: 'test-customized-seeders',
      definition: {
        name: String,
        description: String,
      },
      extensions: {
        seeders: [
          {
            handler: seedByIdIfMissing(bulk[0]),
            options: { version: '0.1.0', runOnWorker: true, verbose: false },
          },
          seedManyByIdIfMissing([bulk[1], bulk[2]]),
          seedByIdIfMissing(bulk[0]),
        ],
      },
    })

    const db = await getDB()
    const Model = db.getModel('test-customized-seeders')

    const all = await Promise.all([
      Model.findById(bulk[0].id),
      Model.findById(bulk[1].id),
      Model.findById(bulk[2].id),
    ])

    assert(!all.some((data) => !data))

    await closeConnection(Model, db)
  },
  ignore,
})
