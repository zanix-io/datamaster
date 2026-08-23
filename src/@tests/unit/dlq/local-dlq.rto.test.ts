import { assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { DLQEntryIdParamsRTO } from 'modules/dlq/dlq-api/rtos/local-dlq.rto.ts'
import {
  DiscardDLQEntryRTO,
  ListDLQEntriesRTO,
  PushDLQEntryRTO,
  RequeueDLQEntryRTO,
} from 'modules/dlq/dlq-api/rtos/dlq.rto.ts'

Deno.test('DLQEntryIdParamsRTO validates a plain "id" string', async () => {
  const rto = await classValidation(DLQEntryIdParamsRTO, { id: '507f191e810c19729de860ea' })
  assertEquals(rto.id, '507f191e810c19729de860ea')
})

Deno.test('PushDLQEntryRTO validates required fields, passes payload/metadata', async () => {
  const rto = await classValidation(PushDLQEntryRTO, {
    processType: 'payment.process',
    origin: 'orders-service',
    payload: { orderId: 'abc123' },
    error: { name: 'PaymentGatewayError', message: 'timeout' },
    maxAttempts: 3,
    metadata: { tenantId: 'acme' },
  })
  assertEquals(rto.processType, 'payment.process')
  assertEquals(rto.origin, 'orders-service')
  assertEquals(rto.payload, { orderId: 'abc123' })
  assertEquals(rto.error, { name: 'PaymentGatewayError', message: 'timeout' })
  assertEquals(rto.maxAttempts, 3)
  assertEquals(rto.metadata, { tenantId: 'acme' })
})

Deno.test('PushDLQEntryRTO rejects a missing processType', async () => {
  await assertRejects(() =>
    classValidation(PushDLQEntryRTO, {
      origin: 'orders-service',
      payload: {},
      error: { name: 'E', message: 'm' },
    })
  )
})

Deno.test('ListDLQEntriesRTO validates a known status, rejects an unknown one', async () => {
  const rto = await classValidation(ListDLQEntriesRTO, {
    processType: 'payment.process',
    status: 'pending',
    page: 2,
    limit: 20,
  })
  assertEquals(rto.processType, 'payment.process')
  assertEquals(rto.status, 'pending')
  assertEquals(rto.page, 2)
  assertEquals(rto.limit, 20)

  await assertRejects(() => classValidation(ListDLQEntriesRTO, { status: 'not-a-real-status' }))
})

Deno.test('RequeueDLQEntryRTO validates optional resetAttempts', async () => {
  const empty = await classValidation(RequeueDLQEntryRTO, {})
  assertEquals(empty.resetAttempts, undefined)

  const set = await classValidation(RequeueDLQEntryRTO, { resetAttempts: true })
  assertEquals(set.resetAttempts, true)
})

Deno.test('DiscardDLQEntryRTO validates optional reason', async () => {
  const empty = await classValidation(DiscardDLQEntryRTO, {})
  assertEquals(empty.reason, undefined)

  const set = await classValidation(DiscardDLQEntryRTO, { reason: 'obsolete' })
  assertEquals(set.reason, 'obsolete')
})
