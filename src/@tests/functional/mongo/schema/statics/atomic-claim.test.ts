import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

type ClaimAttrs = {
  recipientUserId?: string
  interestActions?: { fromId: string; toId: string }[]
}

const newSchema = () =>
  new Schema({
    recipientUserId: String,
    interestActions: [{ fromId: String, toId: String }],
  })

Deno.test({
  ...sanitize,
  name: 'atomicClaim: claims an unset field and returns the updated document',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-set-field', newSchema())

    const doc = await new Model({}).save()

    const result = await Model.atomicClaim<ClaimAttrs>(
      { _id: doc.id, recipientUserId: { $exists: false } },
      { recipientUserId: 'user-1' },
    )

    assertEquals(result.claimed, true)
    assertEquals(result.document?.recipientUserId, 'user-1')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'atomicClaim: a second claim attempt on an already-claimed field loses, with no identity given',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-lost-no-identity', newSchema())

    const doc = await new Model({ recipientUserId: 'user-1' }).save()

    const result = await Model.atomicClaim<ClaimAttrs>(
      { _id: doc.id, recipientUserId: { $exists: false } },
      { recipientUserId: 'user-2' },
    )

    assertEquals(result.claimed, false)
    assertEquals(result.document, null)
    // The field is untouched — the losing write never happened.
    const stored = await Model.findById(doc.id)
    assertEquals(stored?.recipientUserId, 'user-1')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'atomicClaim: a lost claim re-fetches via options.identity, revealing who actually holds it',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-lost-with-identity', newSchema())

    const doc = await new Model({ recipientUserId: 'user-1' }).save()

    const result = await Model.atomicClaim<ClaimAttrs>(
      { _id: doc.id, recipientUserId: { $exists: false } },
      { recipientUserId: 'user-2' },
      { identity: { _id: doc.id } },
    )

    assertEquals(result.claimed, false)
    assertEquals(result.document?.recipientUserId, 'user-1')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'atomicClaim: options.identity matching nothing at all resolves to a null document',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-no-doc', newSchema())

    // A well-formed but non-existent ObjectId — a malformed string would fail Mongoose's own cast
    // before ever reaching the query.
    const missingId = '000000000000000000000000'
    const result = await Model.atomicClaim<ClaimAttrs>(
      { _id: missingId, recipientUserId: { $exists: false } },
      { recipientUserId: 'user-1' },
      { identity: { _id: missingId } },
    )

    assertEquals(result.claimed, false)
    assertEquals(result.document, null)

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'atomicClaim: claim-once-per-pair via $push/$not/$elemMatch — mirrors recordInterestAction',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-push-pair', newSchema())

    const doc = await new Model({}).save()
    const action = { fromId: 'a', toId: 'b' }

    const first = await Model.atomicClaim<ClaimAttrs>(
      { _id: doc.id, interestActions: { $not: { $elemMatch: action } } },
      { $push: { interestActions: action } },
      { identity: { _id: doc.id } },
    )
    assertEquals(first.claimed, true)
    assertEquals(first.document?.interestActions?.length, 1)

    // The identical pair, retried — must not double-insert.
    const second = await Model.atomicClaim<ClaimAttrs>(
      { _id: doc.id, interestActions: { $not: { $elemMatch: action } } },
      { $push: { interestActions: action } },
      { identity: { _id: doc.id } },
    )
    assertEquals(second.claimed, false)
    assertEquals(second.document?.interestActions?.length, 1)

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'atomicClaim: under real concurrency, exactly one of two racing claims wins',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-atomic-claim-race', newSchema())

    const doc = await new Model({}).save()

    const claim = (userId: string) =>
      Model.atomicClaim<ClaimAttrs>(
        { _id: doc.id, recipientUserId: { $exists: false } },
        { recipientUserId: userId },
        { identity: { _id: doc.id } },
      )

    const [a, b] = await Promise.all([claim('user-a'), claim('user-b')])

    // Exactly one call actually won the write.
    assert(
      a.claimed !== b.claimed,
      `expected exactly one winner, got a=${a.claimed} b=${b.claimed}`,
    )

    // The loser's re-fetch (via `identity`) must agree with the winner on who holds the claim.
    const winner = a.claimed ? a : b
    const loser = a.claimed ? b : a
    assertEquals(loser.document?.recipientUserId, winner.document?.recipientUserId)

    await DropCollection(Model, db)
    await db['close']()
  },
})
