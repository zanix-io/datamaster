// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { registerModel } from 'modules/database/defs/models.ts'
import { DropCollection, ignore, Mongo, sanitize } from '../../(setup)/mongo/connector.ts'

/**
 * Regression coverage for `ERR_MONGO_MODEL_NOT_FOUND` thrown for a model that genuinely WAS
 * registered via `registerModel`, whenever `getModel()` is reached before anything else has
 * triggered `defineModels()` — the step (run inside `initialize()`) that actually binds every
 * registered schema into a real, queryable model. A REST-serving app gets this "for free" from its
 * own readiness/health-check machinery accessing `isReady` during boot; a `routes: false`/
 * operations-only app has no equivalent trigger, so its first repository — constructed and calling
 * `getModel()` synchronously, in the same tick as the connector itself — used to see no models
 * bound yet and throw, even though registration genuinely ran.
 */
Deno.test({
  ...sanitize,
  name:
    'getModel binds a model registered via registerModel even when called before initialize() has run',
  fn: async () => {
    registerModel({
      name: 'lazy-bind-model',
      definition: { value: String },
    })

    // Deliberately NOT awaiting `isReady` (nor any other tick) before calling `getModel` —
    // reproduces the exact ordering a `routes: false` app's first repository constructor hits.
    const db = new Mongo()
    const Model = db.getModel<any>('lazy-bind-model')

    const doc = await new Model({ value: 'lazy-bound' }).save()
    assertEquals((await Model.findById(doc.id))?.value, 'lazy-bound')

    await db.isReady
    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})
