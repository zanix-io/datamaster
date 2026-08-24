import { assertEquals, assertRejects } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { DlqEntryIdParamsRTO } from 'modules/dlq/dlq-api/rtos/local-dlq.rto.ts'
import {
  DiscardDlqEntryRTO,
  ListDlqEntriesRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from 'modules/dlq/dlq-api/rtos/dlq.rto.ts'

Deno.test('DlqEntryIdParamsRTO validates a plain "id" string', async () => {
  const rto = await classValidation(DlqEntryIdParamsRTO, { id: '507f191e810c19729de860ea' })
  assertEquals(rto.id, '507f191e810c19729de860ea')
})

Deno.test('PushDlqEntryRTO validates required fields, passes payload/metadata', async () => {
  const rto = await classValidation(PushDlqEntryRTO, {
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

Deno.test('PushDlqEntryRTO rejects a missing processType', async () => {
  await assertRejects(() =>
    classValidation(PushDlqEntryRTO, {
      origin: 'orders-service',
      payload: {},
      error: { name: 'E', message: 'm' },
    })
  )
})

Deno.test('ListDlqEntriesRTO validates a known status, rejects an unknown one', async () => {
  const rto = await classValidation(ListDlqEntriesRTO, {
    processType: 'payment.process',
    status: 'pending',
    page: 2,
    limit: 20,
  })
  assertEquals(rto.processType, 'payment.process')
  assertEquals(rto.status, 'pending')
  assertEquals(rto.page, 2)
  assertEquals(rto.limit, 20)

  await assertRejects(() => classValidation(ListDlqEntriesRTO, { status: 'not-a-real-status' }))
})

Deno.test('RequeueDlqEntryRTO validates optional resetAttempts', async () => {
  const empty = await classValidation(RequeueDlqEntryRTO, {})
  assertEquals(empty.resetAttempts, undefined)

  const set = await classValidation(RequeueDlqEntryRTO, { resetAttempts: true })
  assertEquals(set.resetAttempts, true)
})

Deno.test('DiscardDlqEntryRTO validates optional reason', async () => {
  const empty = await classValidation(DiscardDlqEntryRTO, {})
  assertEquals(empty.reason, undefined)

  const set = await classValidation(DiscardDlqEntryRTO, { reason: 'obsolete' })
  assertEquals(set.reason, 'obsolete')
})
