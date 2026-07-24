// deno-lint-ignore-file no-explicit-any
import type { ConnectorOptions } from '@zanix/server'

import { assert } from '@std/assert'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { ignore, sanitize } from '../../../(setup)/mongo/connector.ts'

// mocks
console.info = () => {}
console.error = () => {}

const seedModelName = 'test-zanix-seeders-tracking-conflict'

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

async function DuplicateNameSeeder(Model: any) {
  await Model.create({ name: 'seeded' })
}

Deno.test({
  ...sanitize,
  name:
    'runAndSaveSeeders logs an error and does not throw when saving duplicate seeder tracking records',
  fn: async () => {
    registerModel({
      name: 'test-seed-save-conflict-target',
      definition: { name: String },
      extensions: {
        // Same handler registered twice produces two identical tracking
        // records ({name, version, status}), colliding on the tracking
        // model's unique index when persisted via a single insertMany.
        seeders: [DuplicateNameSeeder, DuplicateNameSeeder],
      },
    })

    const db = await getTrackedDB()
    const Model = db.getModel<any>('test-seed-save-conflict-target')
    const trackingModel = db.getModel<any>(seedModelName)

    const docs = await Model.find({})
    assert(docs.length >= 1)

    await Model.deleteMany({})
    await trackingModel.deleteMany({})
    await db['close']()
  },
  ignore,
})
