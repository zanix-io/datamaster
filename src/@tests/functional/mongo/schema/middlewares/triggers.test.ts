// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { assert, assertEquals } from '@std/assert'
import { Provider, registerCoreProviderSlot, ZanixWorkerProvider } from '@zanix/server'
import { Schema } from 'mongoose'
import type { Triggers } from 'database/typings/triggers.ts'

const calls: { name: string; args: any }[] = []

// `'worker'` is owned by `@zanix/asyncmq`, which this package's tests don't depend on — must be
// registered here explicitly before decorating a fixture for it, or the decorator throws (a
// reserved core slot that isn't registered yet); see `zanix-libraries-architecture` skill's
// registration-order rule.
registerCoreProviderSlot('worker', ZanixWorkerProvider)

@Provider('worker')
class _FakeWorkerProvider extends ZanixWorkerProvider {
  public override runJob(name: string, options?: any) {
    calls.push({ name, args: options?.args })
    return true
  }
  public override runTask(name: string, options?: any) {
    calls.push({ name, args: options?.args })
    return true
  }
}

const reset = () => {
  calls.length = 0
}

const namesOf = () => calls.map((c) => c.name)

const newTriggerSchema = () => new Schema({ str: String, bool: Boolean })

const triggers: Triggers = {
  pre: {
    created: [{ custom: { name: 'pre-created' } }],
    updated: [{ custom: { name: 'pre-updated' } }],
    deleted: [{ custom: { name: 'pre-deleted' } }],
  },
  post: {
    created: [{ custom: { name: 'post-created' } }],
    updated: [{ custom: { name: 'post-updated' } }],
    deleted: [{ custom: { name: 'post-deleted' } }],
  },
}

Deno.test({
  ...sanitize,
  name: 'triggers fire pre/post created only on document creation (.save() while isNew)',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-create', newTriggerSchema(), {
      extensions: { triggers },
    })

    await new Model({ str: 'a', bool: true }).save()

    assertEquals(namesOf().sort(), ['post-created', 'pre-created'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggers fire pre/post updated (not created) when saving an existing document again',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-update-save', newTriggerSchema(), {
      extensions: { triggers },
    })

    const doc = await new Model({ str: 'a', bool: true }).save()
    reset()

    doc.str = 'b'
    await doc.save()

    assertEquals(namesOf().sort(), ['post-updated', 'pre-updated'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggers fire pre/post updated on findOneAndUpdate (query-level)',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-fou', newTriggerSchema(), {
      extensions: { triggers },
    })

    const doc = await new Model({ str: 'a', bool: true }).save()
    reset()

    await Model.findOneAndUpdate({ _id: doc._id }, { str: 'b' })

    assertEquals(namesOf().sort(), ['post-updated', 'pre-updated'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggers pre-updated payload (query-level) carries the pre-image under _oldData',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-fou-payload', newTriggerSchema(), {
      extensions: { triggers },
    })

    const doc = await new Model({ str: 'a', bool: true }).save()
    reset()

    await Model.findOneAndUpdate({ _id: doc._id }, { str: 'b' })

    const preCall = calls.find((c) => c.name === 'pre-updated')
    assertEquals(preCall?.args.data._oldData.str, 'a')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggers fire pre/post deleted on deleteOne (query-level)',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-deleteone', newTriggerSchema(), {
      extensions: { triggers },
    })

    const doc = await new Model({ str: 'a', bool: true }).save()
    reset()

    await Model.deleteOne({ _id: doc._id })

    assertEquals(namesOf().sort(), ['post-deleted', 'pre-deleted'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggers fire pre/post deleted on findOneAndDelete (query-level)',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-foand', newTriggerSchema(), {
      extensions: { triggers },
    })

    const doc = await new Model({ str: 'a', bool: true }).save()
    reset()

    await Model.findOneAndDelete({ _id: doc._id })

    assertEquals(namesOf().sort(), ['post-deleted', 'pre-deleted'])

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'an action whose conditions do not match is skipped',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-conditions', newTriggerSchema(), {
      extensions: {
        triggers: {
          post: {
            created: [{
              custom: {
                name: 'post-created-conditional',
                conditions: [{ field: 'bool', op: '=', value: false }],
              },
            }],
          },
        },
      },
    })

    await new Model({ str: 'a', bool: true }).save()

    assertEquals(calls.length, 0)

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'an action whose conditions do match is dispatched',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-conditions-match',
      newTriggerSchema(),
      {
        extensions: {
          triggers: {
            post: {
              created: [{
                custom: {
                  name: 'post-created-conditional',
                  conditions: [{ field: 'bool', op: '=', value: false }],
                },
              }],
            },
          },
        },
      },
    )

    await new Model({ str: 'a', bool: false }).save()

    assertEquals(calls.length, 1)
    assertEquals(calls[0].name, 'post-created-conditional')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'nothing dispatches when extensions.triggers is not provided',
  fn: async () => {
    reset()
    const db = await getDB()
    const Model = db.getModel('test-triggers-none', newTriggerSchema())

    await new Model({ str: 'a', bool: true }).save()

    assertEquals(calls.length, 0)

    await DropCollection(Model, db)
    await db['close']()
  },
})

// --- Data protection consistency ------------------------------------------------------------
// Every payload handed to a trigger — the current document, `_old`, or a deleted document, across
// both document-level (`save`) and query-level (`updateOne`/`findOneAndUpdate`/`deleteOne`/
// `findOneAndDelete`) paths — must carry the field's real (unmasked) value, never the masked
// on-disk representation, exactly like a normal `toJSON()` read would produce.

const newProtectedSchema = () =>
  new Schema({
    str: String,
    secret: {
      type: String,
      get: dataProtectionGetter('mask'),
    },
  })

const protectedTriggers: Triggers = {
  pre: {
    updated: [{ custom: { name: 'pre-updated-protected' } }],
    deleted: [{ custom: { name: 'pre-deleted-protected' } }],
  },
  post: {
    created: [{ custom: { name: 'post-created-protected' } }],
    updated: [{ custom: { name: 'post-updated-protected' } }],
    deleted: [{ custom: { name: 'post-deleted-protected' } }],
  },
}

Deno.test({
  ...sanitize,
  name: 'post-created (document-level save) dispatch payload carries the unmasked field',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-create',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    await new Model({ str: 'a', secret: 'top-secret' }).save()

    const call = calls.find((c) => c.name === 'post-created-protected')
    assertEquals(call?.args.data._data.secret, 'top-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'pre/post-updated (document-level .save()) dispatch payloads carry unmasked current and _old',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-doc-update',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    reset()

    doc.secret = 'second-secret'
    await doc.save()

    const preCall = calls.find((c) => c.name === 'pre-updated-protected')
    assertEquals(preCall?.args.data._data.secret, 'second-secret')
    assertEquals(preCall?.args.data._oldData.secret, 'first-secret')

    const postCall = calls.find((c) => c.name === 'post-updated-protected')
    assertEquals(postCall?.args.data._data.secret, 'second-secret')
    assertEquals(postCall?.args.data._oldData.secret, 'first-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'pre/post-updated (findOneAndUpdate, query-level) dispatch payloads carry unmasked values',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-fou',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    await new Model({ str: 'a', secret: 'first-secret' }).save()
    reset()

    await Model.findOneAndUpdate({ str: 'a' }, { secret: 'second-secret' })

    const preCall = calls.find((c) => c.name === 'pre-updated-protected')
    assertEquals(preCall?.args.data._oldData.secret, 'first-secret')

    const postCall = calls.find((c) => c.name === 'post-updated-protected')
    assertEquals(postCall?.args.data._data.secret, 'second-secret')
    assertEquals(postCall?.args.data._oldData.secret, 'first-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'post-updated (updateOne, query-level) dispatch payload carries the unmasked current value',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-updateone',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    await new Model({ str: 'a', secret: 'first-secret' }).save()
    reset()

    await Model.updateOne({ str: 'a' }, { secret: 'second-secret' })

    const postCall = calls.find((c) => c.name === 'post-updated-protected')
    assertEquals(postCall?.args.data._data.secret, 'second-secret')
    assertEquals(postCall?.args.data._oldData.secret, 'first-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'decrypting the dispatch payload never leaks back into what actually gets persisted (create)',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-no-leak-create',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    const saved = await new Model({ str: 'a', secret: 'top-secret' }).save()

    // The trigger dispatch itself saw the real value (already covered above) — the point here is
    // what's actually sitting in the database afterward.
    const call = calls.find((c) => c.name === 'post-created-protected')
    assertEquals(call?.args.data._data.secret, 'top-secret')

    // A completely independent read, bypassing any in-memory reference the hook could have
    // touched — if `forDispatch` had mutated the live document instead of a throwaway snapshot,
    // this raw on-disk value would now be the plaintext instead of the masked one.
    const raw = (await Model.findOne({ _id: saved._id }).lean()) as any
    assert(raw.secret !== 'top-secret')
    assert(typeof raw.secret === 'string' && raw.secret.length > 0)

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'decrypting the dispatch payload never leaks back into what actually gets persisted (document-level update)',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-no-leak-update',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()
    const rawBefore = (await Model.findOne({ _id: doc._id }).lean()) as any
    reset()

    // Only `str` is changed — `secret` is left untouched, so its on-disk value must stay exactly
    // the masked ciphertext `forDispatch` read (and decrypted into a throwaway snapshot) for the
    // dispatch payload, not whatever `forDispatch` produced.
    doc.str = 'b'
    await doc.save()

    const postCall = calls.find((c) => c.name === 'post-updated-protected')
    assertEquals(postCall?.args.data._data.secret, 'first-secret')

    const rawAfter = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(rawAfter.secret, rawBefore.secret)

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'a document-level .save() update with autoProtectOnUpdate explicitly disabled leaves a ' +
    'reassigned protected field as plaintext (isolates this from the triggers middleware, ' +
    'independent of the trigger dispatch decrypt above)',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    // No triggers at all, and `autoProtectOnUpdate` explicitly off (on by default otherwise — see
    // middlewares/data-protection.ts) — isolates this from both `forDispatch`/
    // `transformByDataProtection` and `autoProtectOnUpdate`, to confirm the triggers middleware
    // added in this change never re-protects a reassigned field on its own.
    const Model = db.getModel(
      'test-no-triggers-protected-reencrypt',
      newProtectedSchema(),
      {
        extensions: { autoProtectOnUpdate: false },
      },
    )

    const doc = await new Model({ str: 'a', secret: 'first-secret' }).save()

    doc.secret = 'second-secret'
    await doc.save()

    const raw = (await Model.findOne({ _id: doc._id }).lean()) as any
    assertEquals(raw.secret, 'second-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'pre/post-deleted (deleteOne, query-level) dispatch payloads carry the unmasked field',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    reset()
    const db = await getDB()
    const Model = db.getModel(
      'test-triggers-protected-delete',
      newProtectedSchema(),
      {
        extensions: { triggers: protectedTriggers },
      },
    )

    await new Model({ str: 'a', secret: 'top-secret' }).save()
    reset()

    await Model.deleteOne({ str: 'a' })

    const preCall = calls.find((c) => c.name === 'pre-deleted-protected')
    assertEquals(preCall?.args.data._data.secret, 'top-secret')

    const postCall = calls.find((c) => c.name === 'post-deleted-protected')
    assertEquals(postCall?.args.data._data.secret, 'top-secret')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})
