// deno-lint-ignore-file no-explicit-any
import type { ConnectorOptions } from '@zanix/server'

import { assert, assertEquals } from '@std/assert'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { ignore, sanitize } from '../../../(setup)/mongo/connector.ts'

// mocks
console.info = () => {}

const seedModelName = 'test-zanix-seeders-tracking'

class TrackedMongo extends ZanixMongoConnector {
  constructor(options?: ConnectorOptions) {
    super({ seedModel: seedModelName, ...options })
  }
}
TrackedMongo.prototype['_znx_props_'] = {
  ...TrackedMongo.prototype['_znx_props_'],
  startMode: 'onBoot',
}

const getTrackedDB = async () => {
  const db = await new Promise<TrackedMongo>((resolve) => {
    const instance = new TrackedMongo()
    instance.isReady.then(() => instance.isHealthy().then(() => resolve(instance)))
  })
  return db
}

const modelName = 'test-tracked-seed-target'
let runCount = 0

const registerTrackedModel = () => {
  registerModel({
    name: modelName,
    definition: { name: String },
    extensions: {
      seeders: [
        async function TrackedSeeder(Model: any) {
          runCount++
          await Model.create({ name: 'seeded-once' })
        },
      ],
    },
  })
}

Deno.test({
  ...sanitize,
  name: 'Seed tracking model records executed seeders and prevents re-running them',
  fn: async () => {
    registerTrackedModel()

    const db1 = await getTrackedDB()
    const Model = db1.getModel<any>(modelName)

    assertEquals(runCount, 1)
    const docs = await Model.find({})
    assertEquals(docs.length, 1)

    await db1['close']()

    // Re-register the model definition (definitions are cleared after each `defineModels` run)
    registerTrackedModel()

    const db2 = await getTrackedDB()

    // The seeder should have been skipped on the second boot since the tracking
    // model already recorded a successful run for this name + version.
    assertEquals(runCount, 1)

    const trackingModel = db2.getModel<any>(seedModelName)
    const trackingRecords = await trackingModel.find({})
    assert(trackingRecords.length >= 1)

    const finalModel = db2.getModel<any>(modelName)
    await finalModel.deleteMany({})
    await trackingModel.deleteMany({})
    await db2['close']()
  },
  ignore,
})
