// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../(setup)/mongo/connector.ts'
import { cleanUpPipe, contextSettingPipe, ProgramModule } from '@zanix/server'
import type { HandlerContext } from '@zanix/server'
import { assert } from '@std/assert'
import { Schema } from 'mongoose'

Deno.test({
  ...sanitize,
  name: 'getModel with useALS enters the async context before creating the model',
  fn: async () => {
    const db = await getDB()

    const schema = new Schema({ name: String })

    const id = 'test-connector-als-context'
    // `this.context` (read internally by `getModel` when `useALS` is on) is only populated once
    // `contextSettingPipe` runs — real requests get this for free via the middleware chain, so a
    // direct call here has to reproduce it: enter the id into ALS, then register the matching
    // `ScopedContext` the same way a real request's `contextSettingPipe` would.
    const ctx = { id, payload: {}, locals: {}, cookies: {} } as HandlerContext<never>

    const Model = await ProgramModule.asyncContext.run(
      { id },
      async () => {
        contextSettingPipe(ctx)
        try {
          return db.getModel<any>('test-connector-useals', schema, { useALS: true })
        } finally {
          await cleanUpPipe(ctx)
        }
      },
    )

    assert(Model)

    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})
