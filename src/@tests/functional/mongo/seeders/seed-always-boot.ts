// deno-lint-ignore-file no-explicit-any
// One start of a connector with a `runningMode: 'always'` seeder, run as its own process by
// `seed-model-always-mode.test.ts`: the seeder tracking is per process, so a second start can only
// be reproduced by a second process.
import type { ConnectorOptions } from '@zanix/server'

import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import '../../../(setup)/envars.ts'

class AlwaysTracked extends ZanixMongoConnector {
  constructor(options?: ConnectorOptions) {
    super({ seedModel: 'test-zanix-seeders-tracking-always', ...options })
  }
}
AlwaysTracked.prototype['_znx_props_'] = {
  ...AlwaysTracked.prototype['_znx_props_'],
  startMode: 'onBoot',
}

registerModel({
  name: 'test-seed-always-target',
  definition: { name: String },
  extensions: {
    seeders: [{
      handler: () => {},
      options: { name: 'EverySeeder', runningMode: 'always', verbose: false },
    }],
  },
})

const db = new AlwaysTracked()
await db.isReady
await db.isHealthy()
if (Deno.args[0] === 'inspect') {
  const records = await db.getModel<any>('test-zanix-seeders-tracking-always').find({
    name: /EverySeeder$/,
  })
  Deno.stdout.writeSync(new TextEncoder().encode(`TRACKING_RECORDS=${records.length}\n`))
  await db.getModel<any>('test-zanix-seeders-tracking-always').deleteMany({})
  await db.getModel<any>('test-seed-always-target').deleteMany({})
}
await db['close']()
Deno.exit(0)
