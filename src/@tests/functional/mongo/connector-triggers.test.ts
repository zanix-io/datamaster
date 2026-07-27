// deno-lint-ignore-file no-explicit-any
import type { TriggersModelAttrs } from 'database/typings/models.ts'
import { DropCollection, sanitize } from '../../(setup)/mongo/connector.ts'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { Provider, ZanixWorkerProvider } from '@zanix/server'
import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'
import { registerModel } from 'database/defs/models.ts'
import { assertEquals } from '@std/assert'
import { Schema } from 'mongoose'
import logger from '@zanix/logger'

console.error = () => {}

const calls: { name: string }[] = []

@Provider('worker')
class _FakeWorkerProvider extends ZanixWorkerProvider {
  public override runJob(name: string) {
    calls.push({ name })
    return true
  }
  public override runTask(name: string) {
    calls.push({ name })
    return true
  }
}

Deno.test({
  ...sanitize,
  name: "persisted triggers loaded at connector startup merge into the target model's dispatch",
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-persisted'
    const targetModelName = 'test-connector-triggers-target'

    // First connector: insert a persisted trigger entry targeting the model.
    const setup = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await setup.isReady

    const TriggersModel = setup.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'db-loaded-job' } }] } },
    })

    await setup['close']()

    // Second connector: fresh boot — should read and merge the persisted entry.
    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['db-loaded-job'])

    await DropCollection(db.getModel<TriggersModelAttrs>(triggersModelName), db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "persisted triggers combine with, not replace, a model's static extensions.triggers",
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-combine-persisted'
    const targetModelName = 'test-connector-triggers-combine-target'

    const setup = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await setup.isReady

    const TriggersModel = setup.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'db-loaded-job-2' } }] } },
    })

    await setup['close']()

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }), {
      extensions: {
        triggers: {
          post: { created: [{ custom: { name: 'static-job' } }] },
        },
      },
    })
    await new Model({ str: 'a' }).save()

    assertEquals(new Set(calls.map((c) => c.name)), new Set(['static-job', 'db-loaded-job-2']))

    await DropCollection(db.getModel<TriggersModelAttrs>(triggersModelName), db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'an inactive persisted trigger entry is not merged in',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-inactive-persisted'
    const targetModelName = 'test-connector-triggers-inactive-target'

    const setup = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await setup.isReady

    const TriggersModel = setup.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: false,
      triggers: { post: { created: [{ custom: { name: 'inactive-job' } }] } },
    })

    await setup['close']()

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model({ str: 'a' }).save()

    assertEquals(calls.length, 0)

    await DropCollection(db.getModel<TriggersModelAttrs>(triggersModelName), db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'mail and request triggers can be created purely via the DB, with no static config at all',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-mail-request-persisted'
    const targetModelName = 'test-connector-triggers-mail-request-target'

    const setup = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await setup.isReady

    const TriggersModel = setup.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: {
        post: {
          created: [{
            mail: { to: 'a@b.com', subject: 'Hi', body: { template: 'welcome' } },
            request: { url: 'http://localhost.com', method: 'POST', headers: {} },
          }],
        },
      },
    })

    await setup['close']()

    // Fresh boot, and the target model is registered with NO extensions.triggers whatsoever.
    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model({ str: 'a' }).save()

    assertEquals(
      new Set(calls.map((c) => c.name)),
      new Set([DEFAULT_TRIGGER_JOBS.mail, DEFAULT_TRIGGER_JOBS.request]),
    )

    await DropCollection(db.getModel<TriggersModelAttrs>(triggersModelName), db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'toggling an existing persisted entry to active:false stops it dispatching on the next boot',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-toggle-persisted'
    const targetModelName = 'test-connector-triggers-toggle-target'

    // Boot 1: create the entry active.
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    const TriggersModel1 = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel1.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'toggle-job' } }] } },
    })

    await boot1['close']()

    // Boot 2: fresh boot merges the now-active entry in — confirm it dispatches.
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model2 = boot2.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model2({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['toggle-job'])

    // Disable the SAME entry (an update, not a fresh create) and reboot again.
    const TriggersModel2 = boot2.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel2.updateOne({ model: targetModelName }, { $set: { active: false } })
    await boot2['close']()

    calls.length = 0

    const boot3 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot3.isReady

    const Model3 = boot3.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model3({ str: 'b' }).save()

    assertEquals(calls.length, 0)

    await DropCollection(boot3.getModel<TriggersModelAttrs>(triggersModelName), boot3)
    await DropCollection(Model3, boot3)
    await boot3['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "a model's static extensions.triggers auto-seeds a default persisted entry",
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-seed-persisted'
    const targetModelName = 'test-connector-triggers-seed-target'
    const staticTriggers = { post: { created: [{ custom: { name: 'seed-job' } }] } }

    // Registered via the real registerModel DSL — before the connector even connects — so its
    // static triggers are already known when the connector's seeding pass runs.
    registerModel({
      name: targetModelName,
      definition: { str: String },
      extensions: { triggers: staticTriggers },
    })

    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    const TriggersModel = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    const seeded = await TriggersModel.findOne({ model: targetModelName }).lean()

    assertEquals(seeded?.isDefault, true)
    assertEquals(seeded?.active, true)
    assertEquals(seeded?.triggers, staticTriggers)

    await DropCollection(TriggersModel, boot1)
    await DropCollection(boot1.getModel<any>(targetModelName), boot1)
    await boot1['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'disabling the auto-seeded default entry turns off its code-defined trigger',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-seed-off-persisted'
    const targetModelName = 'test-connector-triggers-seed-off-target'
    const staticTriggers = { post: { created: [{ custom: { name: 'seed-off-job' } }] } }
    const definition = { str: String }

    // Boot 1: connect — the static trigger auto-seeds and fires normally.
    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    const Model1 = boot1.getModel<any>(targetModelName)
    await new Model1({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['seed-off-job'])

    const TriggersModel1 = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel1.updateOne({ model: targetModelName }, { $set: { active: false } })
    await boot1['close']()

    calls.length = 0

    // Boot 2: the seeded entry is now inactive — the code trigger must NOT fire.
    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model2 = boot2.getModel<any>(targetModelName)
    await new Model2({ str: 'b' }).save()

    assertEquals(calls.length, 0)

    await DropCollection(boot2.getModel<TriggersModelAttrs>(triggersModelName), boot2)
    await DropCollection(Model2, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'editing the auto-seeded default entry replaces the code trigger, not adds to it',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-seed-edit-persisted'
    const targetModelName = 'test-connector-triggers-seed-edit-target'
    const staticTriggers = { post: { created: [{ custom: { name: 'original-job' } }] } }
    const definition = { str: String }

    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    const TriggersModel1 = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel1.updateOne({ model: targetModelName }, {
      $set: { triggers: { post: { created: [{ custom: { name: 'edited-job' } }] } } },
    })
    await boot1['close']()

    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model2 = boot2.getModel<any>(targetModelName)
    await new Model2({ str: 'a' }).save()

    // Only the edited DB content fires — never the original code definition too.
    assertEquals(calls.map((c) => c.name), ['edited-job'])

    await DropCollection(boot2.getModel<TriggersModelAttrs>(triggersModelName), boot2)
    await DropCollection(Model2, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "deleting the auto-seeded entry doesn't stick — the next boot re-seeds it",
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-reseed-persisted'
    const targetModelName = 'test-connector-triggers-reseed-target'
    const staticTriggers = { post: { created: [{ custom: { name: 'reseed-job' } }] } }
    const definition = { str: String }

    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    const TriggersModel1 = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel1.deleteOne({ model: targetModelName })
    await boot1['close']()

    registerModel({ name: targetModelName, definition, extensions: { triggers: staticTriggers } })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model2 = boot2.getModel<any>(targetModelName)
    await new Model2({ str: 'a' }).save()

    // Re-seeded fresh from the code's static config — fires again, using the original content.
    assertEquals(calls.map((c) => c.name), ['reseed-job'])

    const TriggersModel2 = boot2.getModel<TriggersModelAttrs>(triggersModelName)
    const reseeded = await TriggersModel2.findOne({ model: targetModelName }).lean()
    assertEquals(reseeded?.isDefault, true)

    await DropCollection(TriggersModel2, boot2)
    await DropCollection(Model2, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggersModel:false means only code triggers, even after a prior connector load',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-leak-persisted'
    const targetModelName = 'test-connector-triggers-leak-target'

    // Connector A: triggersModel enabled, loads a persisted entry into the module-level store.
    const a = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await a.isReady

    const TriggersModel = a.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      isDefault: false,
      triggers: { post: { created: [{ custom: { name: 'leaked-job' } }] } },
    })
    await a['close']()

    const a2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await a2.isReady

    // Connector B: triggersModel FALSE — must mean "only code triggers," regardless of A's load.
    const b = new ZanixMongoConnector({ seedModel: false, triggersModel: false })
    await b.isReady

    const Model = b.getModel<any>(targetModelName, new Schema({ str: String }), {
      extensions: { triggers: { post: { created: [{ custom: { name: 'static-job' } }] } } },
    })
    await new Model({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['static-job'])

    await DropCollection(a2.getModel<TriggersModelAttrs>(triggersModelName), a2)
    await DropCollection(Model, b)
    await a2['close']()
    await b['close']()
  },
})

Deno.test({
  ...sanitize,
  name: "removing a model's static trigger from code deletes its default entry",
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-orphan-persisted'
    const targetModelName = 'test-connector-triggers-orphan-target'
    const definition = { str: String }

    // Boot 1: model has a static trigger — auto-seeds.
    registerModel({
      name: targetModelName,
      definition,
      extensions: { triggers: { post: { created: [{ custom: { name: 'orphan-job' } }] } } },
    })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady
    await boot1['close']()

    // Boot 2: the model is registered again, but with NO extensions.triggers at all (removed).
    registerModel({ name: targetModelName, definition })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const TriggersModel = boot2.getModel<TriggersModelAttrs>(triggersModelName)
    const entry = await TriggersModel.findOne({ model: targetModelName }).lean()
    assertEquals(entry, null)

    const Model = boot2.getModel<any>(targetModelName)
    await new Model({ str: 'a' }).save()
    assertEquals(calls.length, 0)

    await DropCollection(TriggersModel, boot2)
    await DropCollection(Model, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'an untouched default entry re-syncs to match a code change on the next boot',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-resync-persisted'
    const targetModelName = 'test-connector-triggers-resync-target'
    const definition = { str: String }

    registerModel({
      name: targetModelName,
      definition,
      extensions: { triggers: { post: { created: [{ custom: { name: 'old-job' } }] } } },
    })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady
    await boot1['close']()

    // Boot 2: code changed the trigger's content — the entry was never edited in the database.
    registerModel({
      name: targetModelName,
      definition,
      extensions: { triggers: { post: { created: [{ custom: { name: 'new-job' } }] } } },
    })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model = boot2.getModel<any>(targetModelName)
    await new Model({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['new-job'])

    await DropCollection(boot2.getModel<TriggersModelAttrs>(triggersModelName), boot2)
    await DropCollection(Model, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'a manually-edited default entry is left alone even when code changes too',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-no-resync-persisted'
    const targetModelName = 'test-connector-triggers-no-resync-target'
    const definition = { str: String }

    registerModel({
      name: targetModelName,
      definition,
      extensions: { triggers: { post: { created: [{ custom: { name: 'old-job' } }] } } },
    })
    const boot1 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot1.isReady

    // Someone edits the seeded entry directly, diverging from what code last synced.
    const TriggersModel1 = boot1.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel1.updateOne({ model: targetModelName }, {
      $set: { triggers: { post: { created: [{ custom: { name: 'hand-edited-job' } }] } } },
    })
    await boot1['close']()

    // Boot 2: code ALSO changed — but the manual edit must still win.
    registerModel({
      name: targetModelName,
      definition,
      extensions: { triggers: { post: { created: [{ custom: { name: 'new-job' } }] } } },
    })
    const boot2 = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await boot2.isReady

    const Model = boot2.getModel<any>(targetModelName)
    await new Model({ str: 'a' }).save()

    assertEquals(calls.map((c) => c.name), ['hand-edited-job'])

    await DropCollection(boot2.getModel<TriggersModelAttrs>(triggersModelName), boot2)
    await DropCollection(Model, boot2)
    await boot2['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'a write to the triggers model refreshes the registry instantly, no restart needed',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-live-persisted'
    const targetModelName = 'test-connector-triggers-live-target'

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))

    // No persisted entry yet — nothing dispatches.
    await new Model({ str: 'a' }).save()
    assertEquals(calls.length, 0)

    // Add a trigger directly, through this SAME connector, without closing/reopening it.
    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'live-added-job' } }] } },
    })

    // Same connector, same process, no reconnect — the post-save hook already refreshed it.
    await new Model({ str: 'b' }).save()
    assertEquals(calls.map((c) => c.name), ['live-added-job'])

    await DropCollection(TriggersModel, db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'a failing on-write refresh after a document save is logged, not thrown',
  fn: async () => {
    const triggersModelName = 'test-connector-triggers-refresh-fail-save-persisted'

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)

    const errors: unknown[] = []
    const originalError = logger.error.bind(logger)
    logger.error = ((...args: unknown[]) => errors.push(args)) as any

    const originalFind: (...args: any[]) => any = TriggersModel.find.bind(TriggersModel)
    TriggersModel.find = (() => ({
      lean: () => Promise.reject(new Error('refresh read failed')),
    })) as any

    try {
      // The write itself must still succeed even though its post-save refresh hook fails.
      await TriggersModel.create({
        model: 'test-connector-triggers-refresh-fail-save-target',
        active: true,
        triggers: { post: { created: [{ custom: { name: 'x' } }] } },
      })

      assertEquals(errors.length, 1)
      assertEquals(
        (errors[0] as unknown[])[0],
        'Failed to refresh persisted triggers after a write',
      )
    } finally {
      logger.error = originalError
      TriggersModel.find = originalFind as any
    }

    await DropCollection(TriggersModel, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'a failing on-write refresh after updateOne is logged, not thrown',
  fn: async () => {
    const triggersModelName = 'test-connector-triggers-refresh-fail-query-persisted'

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: 'test-connector-triggers-refresh-fail-query-target',
      active: true,
      triggers: { post: { created: [{ custom: { name: 'x' } }] } },
    })

    const errors: unknown[] = []
    const originalError = logger.error.bind(logger)
    logger.error = ((...args: unknown[]) => errors.push(args)) as any

    const originalFind: (...args: any[]) => any = TriggersModel.find.bind(TriggersModel)
    TriggersModel.find = (() => ({
      lean: () => Promise.reject(new Error('refresh read failed')),
    })) as any

    try {
      // The update itself must still succeed even though its post-query refresh hook fails —
      // exercises `refreshAfterQuery`, the query-level counterpart to the document-level test
      // above (`refreshAfterSave`), triggered by `updateOne`/`findOneAndUpdate`/`deleteOne`/
      // `findOneAndDelete` instead of `.save()`.
      await TriggersModel.updateOne(
        { model: 'test-connector-triggers-refresh-fail-query-target' },
        { $set: { active: false } },
      )

      assertEquals(errors.length, 1)
      assertEquals(
        (errors[0] as unknown[])[0],
        'Failed to refresh persisted triggers after a write',
      )
    } finally {
      logger.error = originalError
      TriggersModel.find = originalFind as any
    }

    await DropCollection(TriggersModel, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggersPollInterval picks up a change made by another connector, without restarting',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-poll-persisted'
    const targetModelName = 'test-connector-triggers-poll-target'

    const db = new ZanixMongoConnector({
      seedModel: false,
      triggersModel: triggersModelName,
      triggersPollInterval: 200,
    })
    await db.isReady

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))

    // Simulates an out-of-band write from a separate process/service: a connector with
    // `triggersModel: false` (so it never wires this collection's own refresh hooks or touches
    // the shared in-memory registry) reaching the same collection through the raw schema-instance
    // overload instead.
    const other = new ZanixMongoConnector({ seedModel: false, triggersModel: false })
    await other.isReady

    const rawTriggersSchema = new Schema({
      model: String,
      active: Boolean,
      triggers: Object,
      isDefault: Boolean,
    }, { timestamps: true })
    const OtherTriggersModel = other.getModel(triggersModelName, rawTriggersSchema)
    await OtherTriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'polled-job' } }] } },
    })
    await other['close']()

    // Nothing yet — `db` hasn't polled since the write.
    await new Model({ str: 'before-poll' }).save()
    assertEquals(calls.length, 0)

    // Wait past the poll interval for `db` to pick up the out-of-band write.
    await new Promise((resolve) => setTimeout(resolve, 500))

    await new Model({ str: 'after-poll' }).save()
    assertEquals(calls.map((c) => c.name), ['polled-job'])

    await DropCollection(db.getModel<TriggersModelAttrs>(triggersModelName), db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggersChangeStream degrades gracefully (logs, keeps working) against a standalone Mongo',
  fn: async () => {
    calls.length = 0

    const errors: unknown[] = []
    const originalError = logger.error.bind(logger)
    logger.error = ((...args: unknown[]) => errors.push(args)) as any

    try {
      const triggersModelName = 'test-connector-triggers-changestream-persisted'
      const targetModelName = 'test-connector-triggers-changestream-target'

      const db = new ZanixMongoConnector({
        seedModel: false,
        triggersModel: triggersModelName,
        triggersChangeStream: true,
      })
      await db.isReady

      // The test Mongo instance is a standalone server (no replica set) — `Model.watch()` doesn't
      // throw synchronously for this; MongoDB rejects the underlying $changeStream command
      // asynchronously, moments later, surfacing as an 'error' event on the stream. Either way,
      // this must never crash connector startup — just log and move on. Poll (via recursion, not
      // a loop, to sidestep this project's `no-await-in-loop` lint rule) instead of a fixed sleep,
      // since exactly how long that takes varies with how busy the test Mongo instance is.
      const deadline = Date.now() + 5000
      const waitForError = async (): Promise<void> => {
        if (errors.length > 0 || Date.now() >= deadline) return
        await new Promise((resolve) => setTimeout(resolve, 50))
        await waitForError()
      }
      await waitForError()
      assertEquals(errors.length > 0, true)

      // The other two refresh mechanisms (on-write, polling) are unaffected by the failed watch.
      const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)
      await TriggersModel.create({
        model: targetModelName,
        active: true,
        triggers: { post: { created: [{ custom: { name: 'still-works-job' } }] } },
      })

      const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
      await new Model({ str: 'a' }).save()

      assertEquals(calls.map((c) => c.name), ['still-works-job'])

      await DropCollection(TriggersModel, db)
      await DropCollection(Model, db)
      await db['close']()
    } finally {
      logger.error = originalError
    }
  },
})

Deno.test({
  ...sanitize,
  name: 'toggling a persisted trigger to active:false via updateOne stops it instantly',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-toggle-live-persisted'
    const targetModelName = 'test-connector-triggers-toggle-live-target'

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'toggle-job' } }] } },
    })

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model({ str: 'a' }).save()
    assertEquals(calls.map((c) => c.name), ['toggle-job'])

    // Disable it via a query-level write (`updateOne`, not `.save()`) — exercises the query-level
    // refresh hook (`refreshAfterQuery`), not the document-level one the earlier "instant refresh"
    // test already covers.
    calls.length = 0
    await TriggersModel.updateOne({ model: targetModelName }, { $set: { active: false } })

    // Same connector, no reconnect — should no longer dispatch.
    await new Model({ str: 'b' }).save()
    assertEquals(calls.length, 0)

    await DropCollection(TriggersModel, db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'deleting a persisted trigger entry via deleteOne stops it instantly',
  fn: async () => {
    calls.length = 0

    const triggersModelName = 'test-connector-triggers-delete-live-persisted'
    const targetModelName = 'test-connector-triggers-delete-live-target'

    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: triggersModelName })
    await db.isReady

    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)
    await TriggersModel.create({
      model: targetModelName,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'delete-job' } }] } },
    })

    const Model = db.getModel<any>(targetModelName, new Schema({ str: String }))
    await new Model({ str: 'a' }).save()
    assertEquals(calls.map((c) => c.name), ['delete-job'])

    // Remove the entry entirely via a query-level delete — same `refreshAfterQuery` hook.
    calls.length = 0
    await TriggersModel.deleteOne({ model: targetModelName })

    await new Model({ str: 'b' }).save()
    assertEquals(calls.length, 0)

    await DropCollection(TriggersModel, db)
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'triggersPollInterval stops polling once the connector is closed',
  fn: async () => {
    const triggersModelName = 'test-connector-triggers-poll-stop-persisted'

    const db = new ZanixMongoConnector({
      seedModel: false,
      triggersModel: triggersModelName,
      triggersPollInterval: 100,
    })
    await db.isReady

    const TriggersModel = db.getModel<TriggersModelAttrs>(triggersModelName)

    // A real local `find()` resolves near-instantly, so `close()` would almost never land while a
    // tick is genuinely in flight — the exact race `triggersPollStopped` guards against. Force it
    // deterministically instead of relying on timing luck: arm the spy to delay exactly the next
    // ongoing poll tick's `find()`, then call `close()` while that call is still pending.
    let findCalls = 0
    let delayNextLean = false
    const originalFind: (...args: any[]) => any = TriggersModel.find.bind(TriggersModel)
    TriggersModel.find = ((...args: any[]) => {
      findCalls++
      const query = originalFind(...args)
      if (delayNextLean) {
        delayNextLean = false
        const originalLean = query.lean.bind(query)
        query.lean = (...leanArgs: any[]) =>
          new Promise((resolve) => setTimeout(() => resolve(originalLean(...leanArgs)), 400))
      }
      return query
    }) as any

    // Let the startup load's own find() (already counted before the spy could delay it) settle,
    // then arm the delay for the first ongoing poll tick.
    await new Promise((resolve) => setTimeout(resolve, 50))
    delayNextLean = true

    // Wait for that tick to start (land inside the artificial 400ms delay) — its find() call has
    // already fired and incremented findCalls, but its promise hasn't resolved yet.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const callsWhileInFlight = findCalls

    // Close while that tick is still in flight — this is the exact moment the race can occur.
    await db['close']()

    // Wait past the delayed find()'s resolution (400ms) and a full extra poll interval. Without
    // `triggersPollStopped`, the in-flight tick's `.finally()` would reschedule one more timer
    // *after* `close()`'s own `clearTimeout` already ran, and that timer would have fired an
    // additional find() by now.
    await new Promise((resolve) => setTimeout(resolve, 700))
    assertEquals(findCalls, callsWhileInFlight)

    const cleanup = new ZanixMongoConnector({ seedModel: false, triggersModel: false })
    await cleanup.isReady
    const rawTriggersSchema = new Schema({
      model: String,
      active: Boolean,
      triggers: Object,
      isDefault: Boolean,
    }, { timestamps: true })
    await DropCollection(cleanup.getModel(triggersModelName, rawTriggersSchema), cleanup)
    await cleanup['close']()
  },
})
