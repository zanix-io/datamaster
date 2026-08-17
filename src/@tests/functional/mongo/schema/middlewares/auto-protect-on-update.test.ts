// deno-lint-ignore-file no-explicit-any
import type { DecryptableObject, UnmaskableObject } from 'typings/data.ts'

import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

const newProtectedSchema = () =>
  new Schema({
    str: String,
    secret: {
      type: String,
      get: dataProtectionGetter('mask'),
    },
    phones: {
      type: [String],
      get: dataProtectionGetter('hash'),
    },
  })

Deno.test({
  ...sanitize,
  name: 'autoProtectOnUpdate: on by default — a reassigned protected field gets protected',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-default-on',
      newProtectedSchema(),
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret') // protected without any opt-in — on by default now

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'autoProtectOnUpdate: an explicit false on the model disables it even with no env var set',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-explicit-false-no-env',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: false },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret') // explicit false wins over the on-by-default behavior

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: true — a genuinely new value reassigned to a protected field gets protected',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-new-value',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: true },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret') // protected now

    const reloaded = await Model.findOne({ _id: doc._id })
    assert(reloaded)
    const masked: UnmaskableObject = reloaded.secret as any
    assertEquals(masked?.unmask?.(), 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: true — reassigning the exact same already-protected value does NOT re-protect it',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-noop-reassign',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: true },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    const rawBefore = (await Model.findOne({ _id: doc._id }).lean()) as any

    // Round-trip: load fresh, reassign the SAME (already-protected) value it already has, save.
    const reloaded = await Model.findOne({ _id: doc._id })
    assert(reloaded)
    reloaded.secret = reloaded.get('secret', undefined, { getters: false })
    await reloaded.save()

    const rawAfter = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(rawAfter.secret, rawBefore.secret) // byte-identical — never double-masked

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: true — an untouched hashed array field is never re-hashed on an unrelated update',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-hash-untouched',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: true },
      },
    )

    const doc = await new Model({ str: 'a', phones: ['+15551234567'] }).save()
    const rawBefore = (await Model.findOne({ _id: doc._id }).lean()) as any

    doc.str = 'b' // unrelated field — phones is never touched
    await doc.save()

    const rawAfter = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(rawAfter.phones, rawBefore.phones) // same hash — verify() for the original input still works

    const reloaded = await Model.findOne({ _id: doc._id })
    assert(reloaded)
    const verifiable: any = reloaded.phones
    assert(await verifiable[0].verify('+15551234567'))

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: true — a genuinely new value in a hashed array field gets hashed fresh',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-hash-new-value',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: true },
      },
    )

    const doc = await new Model({ str: 'a', phones: ['+15551234567'] }).save()
    doc.phones = ['+15559876543']
    await doc.save()

    const reloaded = await Model.findOne({ _id: doc._id })
    assert(reloaded)
    const verifiable: any = reloaded.phones
    assert(await verifiable[0].verify('+15559876543'))
    assert(!(await verifiable[0].verify('+15551234567')))

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: AUTO_PROTECT_ON_DB_UPDATE=false disables it when the option is omitted',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    Deno.env.set('AUTO_PROTECT_ON_DB_UPDATE', 'false')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-env-var-false',
      newProtectedSchema(),
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret') // opted out via the env var — left as plaintext

    Deno.env.delete('DATA_SECRET_KEY')
    Deno.env.delete('AUTO_PROTECT_ON_DB_UPDATE')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: an explicit false on the model wins over AUTO_PROTECT_ON_DB_UPDATE=true',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    Deno.env.set('AUTO_PROTECT_ON_DB_UPDATE', 'true')
    const db = await getDB()
    const Model = db.getModel(
      'test-autoprotect-explicit-override',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: false },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret') // explicit false wins — left as plaintext

    Deno.env.delete('DATA_SECRET_KEY')
    Deno.env.delete('AUTO_PROTECT_ON_DB_UPDATE')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'autoProtectOnUpdate: true — an encrypted field also protects new values and skips unchanged ones',
  fn: async () => {
    Deno.env.set('DATA_AES_KEY', 'H3bkwjJIBUMt/ePUbJibeA==')
    const db = await getDB()
    const schema = new Schema({
      ssn: {
        type: String,
        get: dataProtectionGetter({
          strategy: 'encrypt',
          settings: { type: 'symmetric' },
        }),
      },
    })
    const Model = db.getModel('test-autoprotect-encrypt', schema, {
      extensions: { autoProtectOnUpdate: true },
    })

    const doc = await new Model({ ssn: 'first-ssn' }).save()
    const rawBefore = (await Model.findOne({ _id: doc._id }).lean()) as any

    // Unrelated no-op save — must not re-encrypt (would silently rotate the IV/ciphertext, which
    // is otherwise harmless for `decrypt`, but proves the "unchanged" branch is actually taken).
    const reloaded1 = await Model.findOne({ _id: doc._id })
    assert(reloaded1)
    await reloaded1.save()
    const rawAfterNoop = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(rawAfterNoop.ssn, rawBefore.ssn)

    // Genuine new value — must get encrypted.
    const reloaded2 = await Model.findOne({ _id: doc._id })
    assert(reloaded2)
    reloaded2.ssn = 'second-ssn'
    await reloaded2.save()

    const rawAfterChange = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(rawAfterChange.ssn !== 'second-ssn')

    const reloaded3 = await Model.findOne({ _id: doc._id })
    assert(reloaded3)
    const decryptable: DecryptableObject = reloaded3.ssn as any
    assertEquals(await decryptable?.decrypt?.(), 'second-ssn')

    Deno.env.delete('DATA_AES_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})
