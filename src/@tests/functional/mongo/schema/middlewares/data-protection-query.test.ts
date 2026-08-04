// deno-lint-ignore-file no-explicit-any
import type { UnmaskableObject } from 'typings/data.ts'

import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { Schema, Types } from 'mongoose'

const newProtectedSchema = () =>
  new Schema({
    str: String,
    secret: {
      type: String,
      get: dataProtectionGetter('mask'),
    },
  })

const newHashProtectedSchema = () =>
  new Schema({
    str: String,
    secret: {
      type: String,
      get: dataProtectionGetter('hash'),
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

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (findOne): off by default — a plaintext filter matches nothing',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findone-default-off', newProtectedSchema())

    await new Model({ str: 'a', secret: 'a-secret' }).save()
    const found = await Model.findOne({ secret: 'a-secret' })
    assertEquals(found, null) // stored masked, queried as plaintext — never protected without the opt-in flag

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (findOne): true — protects a plain equality filter before the query runs',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findone', newProtectedSchema())

    await new Model({ str: 'a', secret: 'a-secret' }).save()
    const found = await Model.findOne({ secret: 'a-secret' }, null, { useDataPolicies: true })

    assert(found)
    const masked: UnmaskableObject = found.secret as any
    assertEquals(masked?.unmask?.(), 'a-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "useDataPolicies (find): true — protects a protected path's $in condition",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-find-in', newProtectedSchema())

    await new Model({ str: 'a', secret: 'secret-one' }).save()
    await new Model({ str: 'b', secret: 'secret-two' }).save()
    await new Model({ str: 'c', secret: 'secret-three' }).save()

    const docs = await Model.find(
      { secret: { $in: ['secret-one', 'secret-two'] } },
      null,
      { useDataPolicies: true },
    )

    assertEquals(docs.length, 2)
    assertEquals(new Set(docs.map((d) => d.str)), new Set(['a', 'b']))

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "useDataPolicies (find): true — protects a protected path used inside '$or'",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-find-or', newProtectedSchema())

    await new Model({ str: 'a', secret: 'secret-one' }).save()
    await new Model({ str: 'no-match', secret: 'other' }).save()

    const docs = await Model.find(
      { $or: [{ secret: 'secret-one' }, { str: 'never-matches' }] },
      null,
      { useDataPolicies: true },
    )

    assertEquals(docs.length, 1)
    assertEquals(docs[0].str, 'a')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    "useDataPolicies (findOne): true — throws on an unsupported operator ('$regex') against a protected path",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findone-unsupported-op', newProtectedSchema())

    await assertRejects(() =>
      Model.findOne({ secret: { $regex: 'a' } } as any, null, { useDataPolicies: true }).exec()
    )

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    "useDataPolicies (findOne): true — throws when the protected path's active strategy isn't 'mask'",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-findone-hash-strategy', newHashProtectedSchema())

    await assertRejects(() =>
      Model.findOne({ secret: 'a-secret' }, null, { useDataPolicies: true }).exec()
    )

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (paginate): off by default — a plaintext filter matches nothing',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-paginate-default-off', newProtectedSchema())

    await new Model({ str: 'a', secret: 'a-secret' }).save()
    const { docs, total } = await Model.paginate({ filter: { secret: 'a-secret' } })

    assertEquals(docs.length, 0)
    assertEquals(total, 0)

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'useDataPolicies (paginate): true — protects the filter for both the find and the countDocuments call',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-paginate', newProtectedSchema())

    await new Model({ str: 'a', secret: 'shared-secret' }).save()
    await new Model({ str: 'b', secret: 'shared-secret' }).save()
    await new Model({ str: 'c', secret: 'other-secret' }).save()

    const { docs, total } = await Model.paginate({
      filter: { secret: 'shared-secret' },
      useDataPolicies: true,
    })

    // Both the parallel `find` and `countDocuments` calls must independently protect the same
    // caller-provided filter object without racing or double-protecting each other.
    assertEquals(total, 2)
    assertEquals(docs.length, 2)
    assertEquals(new Set(docs.map((d) => d.str)), new Set(['a', 'b']))

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'useDataPolicies (paginateCursor): true — protects the filter before the find call',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-query-protect-paginate-cursor', newProtectedSchema())

    await new Model({ str: 'a', secret: 'shared-secret' }).save()
    await new Model({ str: 'b', secret: 'shared-secret' }).save()
    await new Model({ str: 'c', secret: 'other-secret' }).save()

    const { docs } = await Model.paginateCursor({
      filter: { secret: 'shared-secret' },
      useDataPolicies: true,
    })

    assertEquals(docs.length, 2)
    assertEquals(new Set(docs.map((d) => d.str)), new Set(['a', 'b']))

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})
