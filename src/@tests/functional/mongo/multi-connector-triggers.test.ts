// deno-lint-ignore-file no-explicit-any
import type { TriggersModelAttrs } from 'database/typings/models.ts'
import { assertEquals } from '@std/assert'
import { Connector, Provider, registerCoreProviderSlot, ZanixWorkerProvider } from '@zanix/server'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { DropCollection, ignore, sanitize } from '../../(setup)/mongo/connector.ts'
import { Schema } from 'mongoose'

console.error = () => {}

const calls: { name: string }[] = []

// `'worker'` is owned by `@zanix/asyncmq`, which this package's tests don't depend on — must be
// registered here explicitly before decorating a fixture for it, or the decorator throws (a
// reserved core slot that isn't registered yet); see `zanix-libraries-architecture` skill's
// registration-order rule.
registerCoreProviderSlot('worker', ZanixWorkerProvider)

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

/**
 * A second connector on both a different `@Connector` slot AND a different physical database
 * (`config.dbName`) — regression coverage for the exact scenario confirmed by the user: triggers
 * loaded by a first connector are only lost when a second connector differs in BOTH slot and
 * connection. Same slot (impossible — DI only allows one class per slot) or same connection (the
 * two connectors end up reading/resetting what's effectively the same persisted-triggers
 * collection) don't surface the bug.
 */
@Connector({ slot: 'triggers-secondary', startMode: 'onBoot' })
class SecondaryMongo extends ZanixMongoConnector {
  constructor(triggersModel: string) {
    super({
      seedModel: false,
      triggersModel,
      config: { dbName: 'zanix_datamaster_triggers_secondary' },
    })
  }
}

const getSecondaryDB = (triggersModel: string) =>
  new Promise<SecondaryMongo>((resolve) => {
    const instance = new SecondaryMongo(triggersModel)
    instance.isReady.then(() => instance.isHealthy().then(() => resolve(instance)))
  })

class DefaultMongo extends ZanixMongoConnector {
  constructor(triggersModel: string) {
    super({ seedModel: false, triggersModel })
  }
}
DefaultMongo.prototype['_znx_props_'] = {
  ...DefaultMongo.prototype['_znx_props_'],
  startMode: 'onBoot',
}

const getDefaultDB = (triggersModel: string) =>
  new Promise<DefaultMongo>((resolve) => {
    const instance = new DefaultMongo(triggersModel)
    instance.isReady.then(() => instance.isHealthy().then(() => resolve(instance)))
  })

Deno.test({
  ...sanitize,
  name:
    "a second connector on a different slot AND a different connection doesn't wipe the first's active triggers",
  fn: async () => {
    calls.length = 0

    const triggersModelNameA = 'test-multi-conn-triggers-a-tracking'
    const targetModelNameA = 'test-multi-conn-triggers-a-target'
    const triggersModelNameB = 'test-multi-conn-triggers-b-tracking'
    const targetModelNameB = 'test-multi-conn-triggers-b-target'

    // --- Connector A (default 'database' slot): seed a persisted trigger, then boot for real ---
    const setupA = await getDefaultDB(triggersModelNameA)

    const SetupTriggersModelA = setupA.getModel<TriggersModelAttrs>(
      triggersModelNameA,
    )
    await SetupTriggersModelA.create({
      model: targetModelNameA,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'a-job' } }] } },
    })
    await setupA['close']()

    const dbA = await getDefaultDB(triggersModelNameA)

    // --- Connector B: a genuinely different slot and a genuinely different database ---
    const dbB = await getSecondaryDB(triggersModelNameB)

    const TriggersModelB = dbB.getModel<TriggersModelAttrs>(triggersModelNameB)
    await TriggersModelB.create({
      model: targetModelNameB,
      active: true,
      triggers: { post: { created: [{ custom: { name: 'b-job' } }] } },
    })

    // B's own trigger works.
    const ModelB = dbB.getModel<any>(
      targetModelNameB,
      new Schema({ str: String }),
    )
    await new ModelB({ str: 'b' }).save()
    assertEquals(calls.map((c) => c.name), ['b-job'])

    // A's trigger — loaded BEFORE B ever existed — must still fire. Before the fix, B's boot
    // (`resetPersistedTriggers()`, unscoped) wiped A's in-memory persisted-triggers layer.
    calls.length = 0
    const ModelA = dbA.getModel<any>(
      targetModelNameA,
      new Schema({ str: String }),
    )
    await new ModelA({ str: 'a' }).save()
    assertEquals(calls.map((c) => c.name), ['a-job'])

    await DropCollection(
      dbA.getModel<TriggersModelAttrs>(triggersModelNameA),
      dbA,
    )
    await DropCollection(ModelA, dbA)
    await DropCollection(TriggersModelB, dbB)
    await DropCollection(ModelB, dbB)
    await dbA['close']()
    await dbB['close']()
  },
  ignore,
})
