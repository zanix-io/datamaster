import { assertEquals } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { TriggerModelParamsRTO } from 'modules/triggers/triggers-api/rtos/local-triggers.rto.ts'

Deno.test('TriggerModelParamsRTO validates a plain "model" string', async () => {
  const rto = await classValidation(TriggerModelParamsRTO, {
    model: 'zanix-triggers',
  })
  assertEquals(rto.model, 'zanix-triggers')
})
