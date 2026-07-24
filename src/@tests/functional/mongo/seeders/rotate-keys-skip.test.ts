// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { seedRotateProtectionKeys } from 'mongo/utils/seeders.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { assertEquals } from '@std/assert'

// mocks
console.warn = () => {}

Deno.test({
  ...sanitize,
  name: 'seedRotateProtectionKeys skips execution when the model has no data protection',
  fn: async () => {
    registerModel({
      name: 'test-seeders-rotate-keys-no-protection',
      definition: {
        name: String,
      },
      extensions: {
        seeders: [
          seedRotateProtectionKeys(),
        ],
      },
    })

    const db = await getDB()
    const Model = db.getModel<any>('test-seeders-rotate-keys-no-protection')

    const count = await Model.countDocuments()
    assertEquals(count, 0)

    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})
