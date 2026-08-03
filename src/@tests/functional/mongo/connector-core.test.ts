import { Connector } from '@zanix/server'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'

Deno.test({
  name: 'mongo connector core DSL skips connector registration when MONGO_URI is not set',
  fn: async () => {
    Deno.env.delete('MONGO_URI')

    await import('mongo/connector/core.ts?case=no-uri')
  },
})

Deno.test({
  name: 'mongo connector core DSL registers the default mongo connector when MONGO_URI is set',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost:27017/test')

    try {
      await import('mongo/connector/core.ts?case=with-uri')
    } finally {
      Deno.env.delete('MONGO_URI')
    }
  },
})

Deno.test({
  name:
    "the 'database' core slot is registered by importing ZanixMongoConnector alone — never requires core.ts",
  fn: () => {
    // Regression test for a real bug: a consumer decorating `class Mongo extends
    // ZanixMongoConnector {}` with `@Connector({ slot: 'database' })` inside a Worker whose own
    // module graph never imports `core.ts` (only their own connector file, which imports
    // `mongo/connector/mod.ts`) hit "reserved core connector slot ... hasn't been registered yet"
    // — even though customizing the default connector this way is a documented, legitimate
    // pattern. Fixed by moving the unconditional `registerCoreConnectorSlot('database', ...)` call
    // into `connector/mod.ts` itself, so it's guaranteed by importing `ZanixMongoConnector` from
    // anywhere, regardless of whether `core.ts` (a *separate*, only-conditionally-imported module)
    // ever runs in that execution context.
    class ConsumerMongo extends ZanixMongoConnector {}

    // Must not throw — this is exactly what failed before the fix.
    Connector({ slot: 'database' })(ConsumerMongo as never)
  },
})
