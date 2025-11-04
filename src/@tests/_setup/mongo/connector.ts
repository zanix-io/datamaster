// deno-lint-ignore-file no-explicit-any
import type { ConnectorOptions } from '@zanix/server'

import { ZanixMongoConnector } from 'mongo/connector/mod.ts'

// mocks
console.info = () => {}

// Controls whether certain tests are skipped locally.
// ⚠️ For local use only — do not commit with `ignore = true`.
export const ignore = false

// To avoid Leaks detected (on stop connection and drop collection) set to false
export const sanitize = {
  sanitizeOps: false,
  sanitizeResources: false,
}

export class Mongo extends ZanixMongoConnector {
  constructor(options?: ConnectorOptions) {
    super({
      uri: 'mongodb://localhost',
      ...options,
    })
  }
}

Mongo.prototype['_znx_props_'] = { ...Mongo.prototype['_znx_props_'], startMode: 'onBoot' }

export const getDB = async () => {
  const bd = await new Promise<Mongo>((resolve) => {
    const _bd = new Mongo()
    _bd.connectorReady.then(() => {
      _bd['startConnection']().then(() => resolve(_bd))
    })
  })
  return bd
}

export const DropCollection = async (model: any, db: any) => {
  try {
    await model.deleteMany({}).exec()
    await model.collection.drop()
    await new Promise((resolve) => setTimeout(resolve, db['isReplicaSet'] ? 2000 : 300)) // to warranty real drop
  } catch (err) {
    if ((err as any).code === 26) {
      // NamespaceNotFound, ignored
    } else {
      throw err
    }
  }
}
