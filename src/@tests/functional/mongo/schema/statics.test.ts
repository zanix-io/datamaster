import { DropCollection, getDB, ignore, sanitize } from '../../../_setup/mongo/connector.ts'
import { aesKey } from '../../../_setup/mongo/keys.ts'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { mask, unmask } from 'database/utils/protection.ts'
import { generateHash, validateHash } from '@zanix/helpers'
import { Schema } from 'mongoose'

// mocks
console.debug = () => {}

export const schema = new Schema(
  { name: String, description: String },
)

Deno.test({
  ...sanitize,
  name: 'Schema encryption statics should work correctly by schema model',
  fn: async () => {
    Deno.env.set('DATABASE_AES_KEY', aesKey)

    const db = await getDB()
    const Model = await db.getModel('test-schema-statics', schema)
    assertEquals(Model.encrypt, Model.schema.statics.encrypt)

    // encryption
    const message = 'my message'
    const value = await Model.encrypt(message)

    assertNotEquals(value, message)
    const decrypted = await Model.decrypt(value)
    assertEquals(decrypted, message)

    // hash and mask are the same functions already tested
    assertEquals(Model.hash, generateHash)
    assertEquals(Model.validateHash, validateHash)
    assertEquals(Model.mask, mask)
    assertEquals(Model.unmask, unmask)

    // Drop collection
    await DropCollection(Model, db)

    await db['stopConnection']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Static mongo transactions should committed',
  fn: async function () {
    const db = await getDB()
    const Model = await db.getModel('test-schema-transactions', schema)

    if (Model.isReplicaSet()) {
      const { session, commit } = await Model.startTransaction()
      await Model.create({ description: 'datamaster-transaction' }, { session })
      await new Model({ description: 'datamaster-transaction-2' }).save({ session })
      const dataSaved = await Model.findOne({ description: 'datamaster-transaction' }).exec()
      const dataSaved2 = await Model.findOne({ description: 'datamaster-transaction-2' }).exec()

      assert(!dataSaved)
      assert(!dataSaved2)

      await commit()

      const dataSavedT = await Model.findOne({ description: 'datamaster-transaction' }).exec()
      const dataSavedT2 = await Model.findOne({ description: 'datamaster-transaction-2' }).exec()

      assertEquals(dataSavedT?.description, 'datamaster-transaction')
      assertEquals(dataSavedT2?.description, 'datamaster-transaction-2')
    } else {
      try {
        await Model.startTransaction()
        assert(false)
      } catch {
        assert(true)
      }
    }

    // Drop collection
    await DropCollection(Model, db)

    await db['stopConnection']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Static mongo transactions should aborted',
  fn: async function () {
    const db = await getDB()
    const Model = await db.getModel('test-schema-transactions-1', schema)

    if (Model.isReplicaSet()) {
      const { session, commit, abort } = await Model.startTransaction()
      await Model.create({ description: 'datamaster-transaction-aborted' }, { session })
      await new Model({ description: 'datamaster-transaction-2-aborted' }).save({ session })
      const dataSaved = await Model.findOne({ description: 'datamaster-transaction-aborted' })
        .exec()
      const dataSaved2 = await Model.findOne({ description: 'datamaster-transaction-2-aborted' })
        .exec()

      assert(!dataSaved)
      assert(!dataSaved2)

      await abort()
      assert(session.hasEnded)
      await commit() // This does nothing; the sesion ended error has already been caught.

      const dataSavedT = await Model.findOne({ description: 'datamaster-transaction-aborted' })
        .exec()
      const dataSavedT2 = await Model.findOne({ description: 'datamaster-transaction-2-aborted' })
        .exec()

      assert(!dataSavedT)
      assert(!dataSavedT2)
    } else {
      try {
        await Model.startTransaction()
        assert(false)
      } catch {
        assert(true)
      }
    }

    // Drop collection
    await DropCollection(Model, db)

    await db['stopConnection']()
  },
  ignore,
})
