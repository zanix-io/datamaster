// deno-lint-ignore-file no-explicit-any
import type { UnmaskableObject } from 'typings/data.ts'

import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema, Types } from 'mongoose'

const newProtectedSchema = () =>
  new Schema({
    str: String,
    secret: {
      type: String,
      get: dataProtectionGetter('mask'),
    },
  })

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (updateOne): off by default — a raw $set is left as plaintext',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-updateone-default-off', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.updateOne({ _id: doc._id }, { $set: { secret: 'second-secret' } })

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret') // never protected without the opt-in flag

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (updateOne): true — protects $set fields before the update executes',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-updateone', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.updateOne(
      { _id: doc._id },
      { $set: { secret: 'second-secret' } },
      { useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret')

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
    'useDataPolicies (updateOne, upsert): true — protects $setOnInsert fields on a new document',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-updateone-upsert', newProtectedSchema())

    const id = new Types.ObjectId()
    await Model.updateOne(
      { _id: id },
      { $setOnInsert: { str: 'a', secret: 'fresh-secret' } },
      { upsert: true, useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: id }).lean()) as any
    assert(raw.secret !== 'fresh-secret')

    const reloaded = await Model.findOne({ _id: id })
    assert(reloaded)
    const masked: UnmaskableObject = reloaded.secret as any
    assertEquals(masked?.unmask?.(), 'fresh-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (findOneAndUpdate): off by default — a raw $set is left as plaintext',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-fou-default-off', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.findOneAndUpdate({ _id: doc._id }, { $set: { secret: 'second-secret' } })

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret') // never protected without the opt-in flag

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'useDataPolicies (findOneAndUpdate): true — protects $set fields before the update executes',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findoneandupdate', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.findOneAndUpdate(
      { _id: doc._id },
      { $set: { secret: 'second-secret' } },
      { useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'useDataPolicies (findByIdAndUpdate): off by default — a raw $set is left as plaintext (same query op as findOneAndUpdate)',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-fbiu-default-off', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.findByIdAndUpdate(doc._id, { $set: { secret: 'second-secret' } })

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'useDataPolicies (findByIdAndUpdate): true — covered for free, Mongoose implements it as sugar over findOneAndUpdate',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findbyidandupdate', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.findByIdAndUpdate(
      doc._id,
      { $set: { secret: 'second-secret' } },
      { useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (bulkWrite): off by default — a raw $set is left as plaintext',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-bulkwrite-default-off', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.bulkWrite([
      { updateOne: { filter: { _id: doc._id }, update: { $set: { secret: 'second-secret' } } } },
    ])

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "useDataPolicies (bulkWrite): true — protects updateOne's $set before the batch executes",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-bulkwrite', newProtectedSchema())

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    await Model.bulkWrite(
      [
        { updateOne: { filter: { _id: doc._id }, update: { $set: { secret: 'second-secret' } } } },
      ],
      { useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assert(raw.secret !== 'second-secret')

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
    "useDataPolicies (bulkWrite): true — protects insertOne's document before the batch executes",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-bulkwrite-insert', newProtectedSchema())

    const id = new Types.ObjectId()
    await Model.bulkWrite(
      [{ insertOne: { document: { _id: id, str: 'a', secret: 'fresh-secret' } } }],
      { useDataPolicies: true },
    )

    const raw = (await Model.findOne({ _id: id }).lean()) as any
    assert(raw.secret !== 'fresh-secret')

    const reloaded = await Model.findOne({ _id: id })
    assert(reloaded)
    const masked: UnmaskableObject = reloaded.secret as any
    assertEquals(masked?.unmask?.(), 'fresh-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})
