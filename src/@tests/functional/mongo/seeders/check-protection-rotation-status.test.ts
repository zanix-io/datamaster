// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import {
  checkProtectionRotationStatus,
  seedManyByIdIfMissing,
  seedRotateProtectionKeys,
} from 'mongo/utils/seeders.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

Deno.test({
  ...sanitize,
  name:
    'checkProtectionRotationStatus reports outdated documents left behind by a partial rotation',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const modelName = 'test-check-rotation-status'
    const ids = ['68fb00b33405a3a540d9b981', '68fb00b33405a3a540d9b982', '68fb00b33405a3a540d9b983']

    registerModel({
      name: modelName,
      definition: {
        secret: { type: String, get: dataProtectionGetter('mask') },
        hashedValue: { type: String, get: dataProtectionGetter('hash') },
      },
      extensions: {
        seeders: [
          seedManyByIdIfMissing(ids.map((id) => ({ id, secret: 'a-secret', hashedValue: 'x' }))),
        ],
      },
    })

    const setupDb = await getDB()
    await setupDb['close']()

    // Rotate to v1, but only for the first two documents — the third is deliberately left behind
    // to simulate a partial rotation (a retry exhausted, a concurrent old-key write, ...).
    Deno.env.set('DATA_SECRET_KEY_V1', 'my-secret-key-v1')

    registerModel({
      name: modelName,
      definition: {
        secret: {
          type: String,
          get: dataProtectionGetter({
            activeVersion: 'v1',
            versionConfigs: { v0: { strategy: 'mask' }, v1: { strategy: 'mask' } },
          }),
        },
        hashedValue: { type: String, get: dataProtectionGetter('hash') },
      },
      extensions: {
        seeders: [
          seedRotateProtectionKeys({ filter: { _id: { $in: ids.slice(0, 2) } } }),
        ],
      },
    })

    const db = await getDB()
    const Model = db.getModel<any>(modelName)

    const status = await checkProtectionRotationStatus(Model)

    assertEquals(status.secret, { total: 3, current: 2, outdated: 1 })
    assertEquals(status.hashedValue, undefined) // hash is excluded — no key/version to check

    Deno.env.delete('DATA_SECRET_KEY')
    Deno.env.delete('DATA_SECRET_KEY_V1')
    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'checkProtectionRotationStatus returns an empty object for a model with no data protection',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel<any>(
      'test-check-rotation-status-no-protection',
      new Schema({ str: String }),
    )

    const status = await checkProtectionRotationStatus(Model)
    assertEquals(status, {})

    await DropCollection(Model, db)
    await db['close']()
  },
})
