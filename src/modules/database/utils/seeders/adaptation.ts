import type { DatabaseTypes, SeederHandler, SeederProcessor } from 'database/typings/general.ts'

import { mongoSeederProcessor } from 'mongo/utils/seeders/processor.ts'
import { seederBaseWrapper } from './wrapper.ts'

/** Seed processors for handler execution */
const seedProcessor = {
  get mongo() {
    return mongoSeederProcessor()
  },
  get postgress(): SeederProcessor {
    throw new Error('Not implemented')
  },
}

/** Custom seeder adaptation */
export const seederAdaptation = (seeders: unknown[], model: unknown, type: DatabaseTypes) => {
  const processor = seedProcessor[type]

  const baseVersion = '0.0.0'

  return seeders.map((seeder) => {
    const seed = seeder as SeederHandler

    if (typeof seed === 'function') {
      const name = seed.name
      processor.prepare?.(baseVersion, name, model)
      return seederBaseWrapper(seed, processor, { version: baseVersion, name: seed.name })
    }

    const { handler, options: { version = baseVersion, name = handler.name, ...ops } = {} } = seed

    processor.prepare?.(version, name, model)
    return seederBaseWrapper(handler, processor, { version, name, ...ops })
  })
}
