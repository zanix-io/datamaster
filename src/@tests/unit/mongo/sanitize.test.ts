// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { sanitizeModel } from 'mongo/processor/model/sanitize.ts'

Deno.test('sanitizeModel does nothing when the model has no db', () => {
  const model: any = {}

  sanitizeModel(model)

  assertEquals(model, {})
})

Deno.test('sanitizeModel does nothing when called without a model', () => {
  sanitizeModel(undefined)
})

Deno.test('sanitizeModel removes the srvHost from the srv poller when present', () => {
  const model: any = {
    db: {
      host: 'localhost',
      name: 'mydb',
      client: {
        topology: {
          s: {
            description: { setName: 'rs0' },
            srvPoller: { srvHost: 'cluster.mongodb.net' },
          },
        },
        s: {
          options: { hosts: ['a'], credentials: {}, srvHost: 'x', replicaSet: 'rs0' },
          url: 'mongodb://user:pass@localhost',
        },
      },
    },
  }

  sanitizeModel(model)

  assertEquals(model.db.client.topology.s.srvPoller, {})
  assertEquals(model.db.client.s.url, 'mongodb://*****')
  assertEquals(model.db.host, '*****')
  assertEquals(model.db.name, '*****')
})

Deno.test('sanitizeModel handles a model without a client gracefully', () => {
  const model: any = { db: { host: 'localhost', name: 'mydb' } }

  sanitizeModel(model)

  assertEquals(model.db.host, '*****')
  assertEquals(model.db.name, '*****')
})
