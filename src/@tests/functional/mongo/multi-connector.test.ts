// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertThrows } from '@std/assert'
import { Connector, ZanixConnector } from '@zanix/server'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { DropCollection, getDB, ignore, sanitize } from '../../(setup)/mongo/connector.ts'

// mocks
console.info = () => {}
console.error = () => {}

/**
 * A second, independent Mongo connector — regression coverage for the bug where a single global
 * `ProgramModule.models`/`.seeders` registry meant the first connector to boot consumed and wiped
 * every registered model, leaving any additional connector with nothing bound. Decorated with the
 * real `@Connector` (not the manual `_znx_props_` test hack) specifically so `this.connectorKey`
 * resolves through the actual decorator path, the same as any real consumer's second connector.
 */
@Connector({ slot: 'otrabd', startMode: 'onBoot' })
class SecondaryMongo extends ZanixMongoConnector {
  constructor() {
    super({ seedModel: false })
  }
}

const getSecondaryDB = () =>
  new Promise<SecondaryMongo>((resolve) => {
    const instance = new SecondaryMongo()
    instance.isReady.then(() => instance.isHealthy().then(() => resolve(instance)))
  })

Deno.test({
  ...sanitize,
  name: 'a second connector no longer loses its models to the default connector',
  fn: async () => {
    registerModel({
      name: 'multi-connector-default-model',
      definition: { value: String },
    })
    registerModel(
      {
        name: 'multi-connector-secondary-model',
        definition: { value: String },
      },
      SecondaryMongo,
    )

    const dbDefault = await getDB()
    const dbSecondary = await getSecondaryDB()

    const DefaultModel = dbDefault.getModel<any>(
      'multi-connector-default-model',
    )
    const SecondaryModel = dbSecondary.getModel<any>(
      'multi-connector-secondary-model',
    )

    const defaultDoc = await new DefaultModel({ value: 'from-default' }).save()
    const secondaryDoc = await new SecondaryModel({ value: 'from-secondary' })
      .save()

    assertEquals(
      (await DefaultModel.findById(defaultDoc.id))?.value,
      'from-default',
    )
    assertEquals(
      (await SecondaryModel.findById(secondaryDoc.id))?.value,
      'from-secondary',
    )

    // Each connector only ever bound the model registered for it — isolation, not just presence.
    assertThrows(() => dbDefault.getModel('multi-connector-secondary-model'))
    assertThrows(() => dbSecondary.getModel('multi-connector-default-model'))

    await DropCollection(DefaultModel, dbDefault)
    await DropCollection(SecondaryModel, dbSecondary)
    await dbDefault['close']()
    await dbSecondary['close']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name:
    'registerModel throws immediately when given a connector that was never @Connector-decorated',
  fn: () => {
    class UndecoratedConnector extends ZanixConnector {
      protected override initialize() {}
      protected override close() {}
      public override isHealthy() {
        return true
      }
    }

    assertThrows(
      () =>
        registerModel(
          { name: 'unreachable-model', definition: { value: String } },
          UndecoratedConnector as never,
        ),
      Error,
      "hasn't been decorated with @Connector yet",
    )
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'getModel names the connector a model IS registered for, when asked from the wrong one',
  fn: async () => {
    registerModel(
      { name: 'multi-connector-error-model', definition: { value: String } },
      SecondaryMongo,
    )

    const dbDefault = await getDB()

    let caught: any
    try {
      dbDefault.getModel('multi-connector-error-model')
    } catch (e) {
      caught = e
    }

    assertEquals(caught?.meta?.kind, 'wrong-connector')
    assertEquals(caught?.meta?.registeredFor, ['SecondaryMongo'])

    await dbDefault['close']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'getModel reports a model as never registered when no other connector has it either',
  fn: async () => {
    const dbDefault = await getDB()

    let caught: any
    try {
      dbDefault.getModel('multi-connector-nonexistent-model')
    } catch (e) {
      caught = e
    }

    assertEquals(caught?.meta?.kind, 'never-registered')

    await dbDefault['close']()
  },
  ignore,
})
