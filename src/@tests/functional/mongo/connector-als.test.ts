// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../(setup)/mongo/connector.ts'
import { ProgramModule } from '@zanix/server'
import { assert } from '@std/assert'
import { Schema } from 'mongoose'

Deno.test({
  ...sanitize,
  name: 'getModel with useALS enters the async context before creating the model',
  fn: async () => {
    const db = await getDB()

    const schema = new Schema({ name: String })

    const Model = await ProgramModule.asyncContext.run(
      { id: 'test-connector-als-context' },
      () => db.getModel<any>('test-connector-useals', schema, { useALS: true }),
    )

    assert(Model)

    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})
