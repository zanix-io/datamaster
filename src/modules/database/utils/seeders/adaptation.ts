import type { DatabaseTypes, SeederHandler } from 'database/typings/general.ts'

import { seederProcessor } from './processor.ts'
import { seederBaseWrapper } from './wrapper.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/** Seed processors for handler execution — only `mongo` is implemented (see `DatabaseTypes`). */
const seedProcessor = {
  mongo: (connectorKey: string) =>
    seederProcessor((model) => model.modelName || model.name, connectorKey),
}

/** Custom seeder adaptation */
export const seederAdaptation = (
  seeders: unknown[],
  model: unknown,
  type: DatabaseTypes,
  connectorKey: string = DEFAULT_CONNECTOR_KEY,
) => {
  const processor = seedProcessor[type]?.(connectorKey)
  if (!processor) {
    throw new Error(
      `Not implemented: no seed processor for database type "${type}"`,
    )
  }

  const baseVersion = '0.0.0'

  return seeders.map((seeder) => {
    const seed = seeder as SeederHandler

    if (typeof seed === 'function') {
      const name = seed.name
      processor.prepare?.(baseVersion, name, model)
      return seederBaseWrapper(seed, processor, {
        version: baseVersion,
        name: seed.name,
      })
    }

    const {
      handler,
      options: { version = baseVersion, name = handler.name, ...ops } = {},
    } = seed

    processor.prepare?.(version, name, model)
    return seederBaseWrapper(handler, processor, { version, name, ...ops })
  })
}
