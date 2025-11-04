import { defineModelHOC } from 'modules/database/hocs/models.ts'
import { getDB, ignore, sanitize } from '../../../_setup/mongo/connector.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

// deno-lint-ignore no-explicit-any
const mongoPasswordValidation = (Model: any) => {
  assert(!Model.db._connectionString)
  assert(!Model.db.$initialConnection)
  assert(!Model.db.$dbName)

  assertEquals(Model.db.client.s.url, 'mongodb://*****')
  assertEquals(Model.db.host, '*****')
  assertEquals(Model.db.name, '*****')

  if (!Model?.db) return Model

  const { db } = Model

  assert(!db._connectionString)
  assert(!db.$initialConnection)
  assert(!db.$dbName)

  const client = db.client
  if (client) {
    const topology = client.topology?.s
    if (topology) {
      assert(!topology.description?.setName)
      assertEquals(topology.credentials, {})
      assertEquals(topology.seedlist, [])

      if (topology.srvPoller) assert(!topology.srvPoller.srvHost)
    }

    const clientOptions = client.s?.options
    if (clientOptions) {
      assertEquals(clientOptions.hosts, [])
      assertEquals(clientOptions.credentials, {})
      assert(!clientOptions.srvHost)
      assert(!clientOptions.replicaSet)
    }

    if (client.s) assertEquals(client.s.url, 'mongodb://*****')
  }

  if ('host' in db) assertEquals(db.host, '*****')
  if ('name' in db) assertEquals(db.name, '*****')
}

Deno.test({
  ...sanitize,
  name: 'Valide mongo db sensible data instanced',
  fn: async () => {
    defineModelHOC({
      name: 'test-security-model',
      definition: {
        name: String,
        description: String,
      },
    })

    const db = await getDB()

    const ModelByHOC = db.getModel('test-security-model')

    mongoPasswordValidation(ModelByHOC)

    const ModelBySchema = await db.getModel(
      'test-security-model-by-schema',
      new Schema({
        name: String,
        description: String,
      }),
    )

    mongoPasswordValidation(ModelBySchema)

    await db['stopConnection']()
  },
  ignore,
})
