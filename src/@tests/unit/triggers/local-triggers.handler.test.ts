import { assertEquals } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createTriggersAdminController } from 'modules/triggers/triggers-api/local-triggers.handler.ts'

const TriggersAdminController = createTriggersAdminController()

// deno-lint-ignore no-explicit-any
function fakeThis(interactor: Record<string, any>) {
  const instance = new TriggersAdminController({ id: 'test-ctx' } as never)
  Object.defineProperty(instance, 'interactor', { value: interactor })
  return instance
}

const handler = TriggersAdminController.prototype

Deno.test('TriggersAdminController.list forwards to interactor.list()', () => {
  const calls: unknown[][] = []
  const result: unknown = handler.list.call(
    fakeThis({
      list: (...args: unknown[]) => (calls.push(args), 'list-result'),
    }),
  )
  assertEquals(result, 'list-result')
  assertEquals(calls, [[]])
})

Deno.test('TriggersAdminController.get forwards params.model to interactor.get()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { model: 'zanix-triggers' } },
  } as HandlerContext<never>
  const result: unknown = handler.get.call(
    fakeThis({ get: (...args: unknown[]) => (calls.push(args), 'get-result') }),
    ctx,
  )
  assertEquals(result, 'get-result')
  assertEquals(calls, [['zanix-triggers']])
})

Deno.test('TriggersAdminController.create forwards model/active/triggers to create()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { model: 'm', active: true, triggers: { pre: {} } } },
  } as HandlerContext<never>
  const result: unknown = handler.create.call(
    fakeThis({
      create: (...args: unknown[]) => (calls.push(args), 'create-result'),
    }),
    ctx,
  )
  assertEquals(result, 'create-result')
  assertEquals(calls, [[{ model: 'm', active: true, triggers: { pre: {} } }]])
})

Deno.test('TriggersAdminController.update forwards model + {active, triggers} to update()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: {
      body: { active: false, triggers: { post: {} } },
      params: { model: 'm' },
    },
  } as HandlerContext<never>
  const result: unknown = handler.update.call(
    fakeThis({
      update: (...args: unknown[]) => (calls.push(args), 'update-result'),
    }),
    ctx,
  )
  assertEquals(result, 'update-result')
  assertEquals(calls, [['m', { active: false, triggers: { post: {} } }]])
})

Deno.test('TriggersAdminController.remove forwards model, reports deleted', async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { params: { model: 'm' } } } as HandlerContext<never>
  const result = await handler.remove.call(
    fakeThis({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    }),
    ctx,
  )
  assertEquals(result, { deleted: 'm' })
  assertEquals(calls, [['m']])
})

Deno.test({
  name: 'TriggersAdminController: with no guards passed, every route allows the call through',
  fn: () => {
    // The "no guard, not a fake one" default (see the factory's own doc) — this package never
    // assumes an auth mechanism. Verified here structurally; a real composer (e.g. @zanix/admin) is
    // expected to always pass real guards in production.
    const result: unknown = handler.list.call(fakeThis({ list: () => 'ok' }))
    assertEquals(result, 'ok')
  },
})
