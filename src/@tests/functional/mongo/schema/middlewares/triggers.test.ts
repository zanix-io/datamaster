// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { assertEquals } from '@std/assert'
import { Provider, ZanixWorkerProvider } from '@zanix/server'
import { Schema } from 'mongoose'
import type { Triggers } from 'database/typings/triggers.ts'

const calls: { name: string; args: any }[] = []

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
    const Model = db.getModel('test-triggers-fou', newTriggerSchema(), { extensions: { triggers } })

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
    const Model = db.getModel('test-triggers-conditions-match', newTriggerSchema(), {
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
