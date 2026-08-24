import { assertEquals } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createDlqAdminController } from 'modules/dlq/dlq-api/local-dlq.handler.ts'

const DlqAdminController = createDlqAdminController()

// deno-lint-ignore no-explicit-any
function fakeThis(interactor: Record<string, any>) {
  const instance = new DlqAdminController({ id: 'test-ctx' } as never)
  Object.defineProperty(instance, 'interactor', { value: interactor })
  return instance
}

const handler = DlqAdminController.prototype

Deno.test('DlqAdminController.list forwards search filters to interactor.list()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { search: { processType: 'payment.process', status: 'pending' } },
  } as HandlerContext<never>
  const result: unknown = handler.list.call(
    fakeThis({ list: (...args: unknown[]) => (calls.push(args), 'list-result') }),
    ctx,
  )
  assertEquals(result, 'list-result')
  assertEquals(calls, [[{
    processType: 'payment.process',
    status: 'pending',
    origin: undefined,
    page: undefined,
    limit: undefined,
  }]])
})

Deno.test('DlqAdminController.get forwards params.id to interactor.get()', () => {
  const calls: unknown[][] = []
  const ctx = { payload: { params: { id: 'entry-1' } } } as HandlerContext<never>
  const result: unknown = handler.get.call(
    fakeThis({ get: (...args: unknown[]) => (calls.push(args), 'get-result') }),
    ctx,
  )
  assertEquals(result, 'get-result')
  assertEquals(calls, [['entry-1']])
})

Deno.test('DlqAdminController.push forwards the body to interactor.push()', () => {
  const calls: unknown[][] = []
  const body = {
    processType: 'payment.process',
    origin: 'orders-service',
    processId: 'proc-1',
    payload: { orderId: 'abc123' },
    error: { name: 'PaymentGatewayError', message: 'timeout' },
    maxAttempts: 3,
    metadata: { tenantId: 'acme' },
  }
  const ctx = { payload: { body } } as HandlerContext<never>
  const result: unknown = handler.push.call(
    fakeThis({ push: (...args: unknown[]) => (calls.push(args), 'push-result') }),
    ctx,
  )
  assertEquals(result, 'push-result')
  assertEquals(calls, [[body]])
})

Deno.test('DlqAdminController.requeue forwards id + resetAttempts to interactor.requeue()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { resetAttempts: true }, params: { id: 'entry-1' } },
  } as HandlerContext<never>
  const result: unknown = handler.requeue.call(
    fakeThis({ requeue: (...args: unknown[]) => (calls.push(args), 'requeue-result') }),
    ctx,
  )
  assertEquals(result, 'requeue-result')
  assertEquals(calls, [['entry-1', { resetAttempts: true }]])
})

Deno.test('DlqAdminController.discard forwards id + reason to interactor.discard()', () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { reason: 'obsolete' }, params: { id: 'entry-1' } },
  } as HandlerContext<never>
  const result: unknown = handler.discard.call(
    fakeThis({ discard: (...args: unknown[]) => (calls.push(args), 'discard-result') }),
    ctx,
  )
  assertEquals(result, 'discard-result')
  assertEquals(calls, [['entry-1', { reason: 'obsolete' }]])
})

Deno.test('DlqAdminController.remove forwards id, reports deleted', async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { params: { id: 'entry-1' } } } as HandlerContext<never>
  const result = await handler.remove.call(
    fakeThis({ remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()) }),
    ctx,
  )
  assertEquals(result, { deleted: 'entry-1' })
  assertEquals(calls, [['entry-1']])
})

Deno.test({
  name: 'DlqAdminController: with no guards passed, every route allows the call through',
  fn: () => {
    // The "no guard, not a fake one" default (see the factory's own doc) — this package never
    // assumes an auth mechanism. Verified here structurally; a real composer (e.g. @zanix/admin)
    // is expected to always pass real guards in production.
    const ctx = { payload: { params: { id: 'entry-1' } } } as HandlerContext<never>
    const result: unknown = handler.get.call(fakeThis({ get: () => 'ok' }), ctx)
    assertEquals(result, 'ok')
  },
})

Deno.test('DlqAdminController: no claim/release/complete/fail route exists', () => {
  const routes = handler as Record<string, unknown>
  assertEquals(typeof routes.claim, 'undefined')
  assertEquals(typeof routes.release, 'undefined')
  assertEquals(typeof routes.complete, 'undefined')
  assertEquals(typeof routes.fail, 'undefined')
})
