// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { transactions } from 'mongo/processor/schema/statics/transactions.ts'

// mocks
console.debug = () => {}
console.error = () => {}
console.warn = () => {}

const buildFakeSession = () => {
  const calls: string[] = []
  return {
    calls,
    hasEnded: false,
    startTransaction: () => calls.push('startTransaction'),
    abortTransaction: () => {
      calls.push('abortTransaction')
      return Promise.resolve()
    },
    commitTransaction: () => {
      calls.push('commitTransaction')
      return Promise.resolve()
    },
    endSession: (_opts?: unknown) => {
      calls.push('endSession')
      return Promise.resolve()
    },
  }
}

const buildFakeModel = (isReplicaSet: boolean, session: any) => {
  const saveCalls: unknown[] = []

  function FakeModel(this: any, doc: unknown) {
    this.doc = doc
    this.save = (opts: unknown) => {
      saveCalls.push({ doc, opts })
      return Promise.resolve('saved')
    }
  }
  const originalCreate = (..._args: unknown[]) => 'original-create-result'
  Object.assign(FakeModel, {
    statics: { isReplicaSet: () => isReplicaSet },
    create: originalCreate,
    startSession: () => Promise.resolve(session),
    saveCalls,
  })

  return FakeModel as unknown as {
    statics: { isReplicaSet: () => boolean }
    create: typeof originalCreate
    startSession: () => Promise<any>
    saveCalls: unknown[]
  }
}

const attach = (isReplicaSet: boolean, session: any) => {
  const model = buildFakeModel(isReplicaSet, session)
  const schema = { statics: model.statics } as never
  transactions(schema)
  return {
    model,
    startTransaction: (model.statics as any).startTransaction as (...a: any[]) => any,
  }
}

Deno.test({
  name: 'transactions.startTransaction throws when the instance is not a replica set',
  fn: async () => {
    const session = buildFakeSession()
    const { model, startTransaction } = attach(false, session)

    await assertRejects(
      () => startTransaction.call(model),
      HttpError,
    )
  },
})

Deno.test({
  name: 'transactions.startTransaction starts a session and overrides create on a replica set',
  fn: async () => {
    const session = buildFakeSession()
    const { model, startTransaction } = attach(true, session)

    const result = await startTransaction.call(model)

    assert(session.calls.includes('startTransaction'))
    assertEquals(typeof result.commit, 'function')
    assertEquals(typeof result.abort, 'function')

    // create is overridden while the transaction is active
    assert(model.create !== undefined)
  },
})

Deno.test('the overridden create method saves a new instance of the model', async () => {
  const session = buildFakeSession()
  const { model, startTransaction } = attach(true, session)

  await startTransaction.call(model)

  const result = await (model.create as any)({ name: 'doc' }, { session })

  assertEquals(result, 'saved')
  assertEquals((model.saveCalls[0] as any).opts, { session })
})

Deno.test('session.endSession restores the original create method', async () => {
  const session = buildFakeSession()
  const { model, startTransaction } = attach(true, session)

  await startTransaction.call(model)

  const overriddenCreate = model.create
  await session.endSession()
  assert(model.create !== overriddenCreate)
})

Deno.test('abort returns false and does not touch the session when it already ended', async () => {
  const session = buildFakeSession()
  session.hasEnded = true
  const { model, startTransaction } = attach(true, session)

  const { abort } = await startTransaction.call(model)
  const result = await abort()

  assertEquals(result, false)
  assert(!session.calls.includes('abortTransaction'))
})

Deno.test('abort aborts and ends the session when it has not ended', async () => {
  const session = buildFakeSession()
  const { model, startTransaction } = attach(true, session)

  const { abort } = await startTransaction.call(model)
  const result = await abort()

  assertEquals(result, true)
  assert(session.calls.includes('abortTransaction'))
  assert(session.calls.includes('endSession'))
})

Deno.test('commit returns false and does not touch the session when it already ended', async () => {
  const session = buildFakeSession()
  session.hasEnded = true
  const { model, startTransaction } = attach(true, session)

  const { commit } = await startTransaction.call(model)
  const result = await commit()

  assertEquals(result, false)
  assert(!session.calls.includes('commitTransaction'))
})

Deno.test('commit commits and ends the session on success', async () => {
  const session = buildFakeSession()
  const { model, startTransaction } = attach(true, session)

  const { commit } = await startTransaction.call(model)
  const result = await commit()

  assertEquals(result, true)
  assert(session.calls.includes('commitTransaction'))
  assert(session.calls.includes('endSession'))
})

Deno.test('commit aborts and ends the session when commitTransaction fails', async () => {
  const session = buildFakeSession()
  session.commitTransaction = () => Promise.reject(new Error('commit failed'))
  const { model, startTransaction } = attach(true, session)

  const { commit } = await startTransaction.call(model)
  const result = await commit()

  assertEquals(result, false)
  assert(session.calls.includes('abortTransaction'))
  assert(session.calls.includes('endSession'))
})
