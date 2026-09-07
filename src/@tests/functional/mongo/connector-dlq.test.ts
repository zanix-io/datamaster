import { DropCollection, sanitize } from '../../(setup)/mongo/connector.ts'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { DLQ_MODEL_ENV, dlqModelName } from 'modules/dlq/dlq.model.ts'
import { assertEquals, assertExists } from '@std/assert'

console.error = () => {}

Deno.test({
  ...sanitize,
  name:
    'DLQ_MODEL_NAME alone (no explicit registerDlqModel call) is enough to boot a working DLQ collection',
  fn: async () => {
    const modelName = 'test-connector-dlq-auto-registered'
    Deno.env.set(DLQ_MODEL_ENV, modelName)

    try {
      // A fresh connector — this app never called `registerDlqModel()` itself; the connector's own
      // default-connector instance (`resolvedConnectorKey === 'database'`, since it's never
      // `@Connector`-decorated here) is what has to auto-register it, from `DLQ_MODEL_NAME` alone.
      const db = new ZanixMongoConnector({ seedModel: false, triggersModel: false })
      await db.isReady

      assertEquals(dlqModelName(), modelName)

      // Real read/write through the auto-registered model — proves it's genuinely bound, not just
      // present in the registry.
      // deno-lint-ignore no-explicit-any
      const Model = db.getModel<any>(modelName)
      const doc = await Model.create({
        processType: 'test-process',
        origin: 'functional-test',
        payload: { ok: true },
        error: { name: 'Error', message: 'boom' },
        errorHistory: [],
        attempts: 0,
        status: 'pending',
      })

      // deno-lint-ignore no-explicit-any
      const found: any = await Model.findById(doc._id).lean()
      assertExists(found)
      assertEquals(found?.processType, 'test-process')

      await DropCollection(Model, db)
      await db['close']()
    } finally {
      Deno.env.delete(DLQ_MODEL_ENV)
    }
  },
})
