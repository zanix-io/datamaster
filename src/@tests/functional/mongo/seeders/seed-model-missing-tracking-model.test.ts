// deno-lint-ignore-file no-explicit-any
import type { ConnectorOptions } from '@zanix/server'

import { assert, assertEquals } from '@std/assert'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import ProgramModule from 'modules/program/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'
import logger from '@zanix/logger'
import { ignore, sanitize } from '../../../(setup)/mongo/connector.ts'

// mocks
console.info = () => {}
console.error = () => {}

const seedModelName = 'test-zanix-seeders-tracking-missing-model'

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

async function GhostSeeder(Model: any) {
  await Model.create({ name: 'seeded' })
}

Deno.test({
  ...sanitize,
  name:
    'runAndSaveSeeders logs an error and does not throw when save data references a database with no bound tracking model',
  fn: async () => {
    registerModel({
      name: 'test-seed-missing-tracking-model-target',
      definition: { name: String },
      extensions: { seeders: [GhostSeeder] },
    })

    // Inject a "save" entry for a database that never went through the "find" phase, so
    // `defineSeedModelOnce` never binds a tracking model for it. This forces the `!Model`
    // guard in `runAndSaveSeeders` (seeders.ts) without relying on a real data race.
    ProgramModule.seeders.addDataToQuery({
      data: { name: 'ghost:seeder', status: 'success', version: '0.0.0', duration: 0 },
      action: 'save',
      database: 'phantom-db',
      connectorKey: DEFAULT_CONNECTOR_KEY,
    })

    const errors: unknown[] = []
    const originalError = logger.error.bind(logger)
    logger.error = ((...args: unknown[]) => errors.push(args)) as any

    let db: TrackedMongo
    try {
      db = await getTrackedDB()
    } finally {
      logger.error = originalError
    }

    const call = errors.find((args) =>
      (args as [string])[0].includes(`'${TrackedMongo.name}' class`)
    ) as [string, any] | undefined
    assert(call, 'expected the "no seed-tracking model bound" error to be logged')
    assertEquals(call[1].code, 'MONGO_SEEDER_MODEL_NOT_BOUND')
    assertEquals(call[1].meta.database, 'phantom-db')

    const Model = db.getModel<any>('test-seed-missing-tracking-model-target')
    const trackingModel = db.getModel<any>(seedModelName)
    await Model.deleteMany({})
    await trackingModel.deleteMany({})
    await db['close']()
  },
  ignore,
})
