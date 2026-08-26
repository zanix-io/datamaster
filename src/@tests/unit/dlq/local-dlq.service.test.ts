import { assertEquals } from '@std/assert'
import { DlqAdminService } from 'modules/dlq/dlq.service.ts'
import type { DlqProvider } from 'modules/dlq/dlq.provider.ts'

function fakeService(provider: Partial<DlqProvider>) {
  const instance = Object.create(DlqAdminService.prototype)
  Object.defineProperty(instance, 'providers', {
    value: { get: () => provider },
  })
  return instance
}

Deno.test('DlqAdminService delegates every exposed method to DlqProvider', async () => {
  const calls: unknown[] = []
  const provider: Partial<DlqProvider> = {
    push: (input) => (calls.push(['push', input]), Promise.resolve({} as never)),
    get: (id) => (calls.push(['get', id]), Promise.resolve({} as never)),
    list: (options) => (calls.push(['list', options]), Promise.resolve({} as never)),
    requeue: (
      id,
      options,
    ) => (calls.push(['requeue', id, options]), Promise.resolve({} as never)),
    discard: (
      id,
      options,
    ) => (calls.push(['discard', id, options]), Promise.resolve({} as never)),
    remove: (id) => (calls.push(['remove', id]), Promise.resolve()),
  }
  const service: DlqAdminService = fakeService(provider)

  const pushInput = {
    processType: 'payment.process',
    origin: 'orders-service',
    payload: { orderId: 'abc123' },
    error: { name: 'PaymentGatewayError', message: 'timeout' },
  }
  await service.push(pushInput)
  await service.get('id-1')
  await service.list({ processType: 'payment.process' })
  await service.requeue('id-1', { resetAttempts: true })
  await service.discard('id-1', { reason: 'obsolete' })
  await service.remove('id-1')

  assertEquals(calls, [
    ['push', pushInput],
    ['get', 'id-1'],
    ['list', { processType: 'payment.process' }],
    ['requeue', 'id-1', { resetAttempts: true }],
    ['discard', 'id-1', { reason: 'obsolete' }],
    ['remove', 'id-1'],
  ])
})

Deno.test('DlqAdminService has no claim/release/complete/fail — lease primitives stay off', () => {
  const service = DlqAdminService.prototype as unknown as Record<string, unknown>
  assertEquals(typeof service.claim, 'undefined')
  assertEquals(typeof service.release, 'undefined')
  assertEquals(typeof service.complete, 'undefined')
  assertEquals(typeof service.fail, 'undefined')
})
