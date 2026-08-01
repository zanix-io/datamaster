import { assertEquals, assertThrows } from '@std/assert'
import {
  getRegisteredTriggerActionJobs,
  registerTriggerActionJob,
} from 'database/defs/trigger-actions.ts'
import ProgramModule from 'modules/program/mod.ts'

console.error = () => {}

const reset = () => {
  ProgramModule.triggerActionJobs.resetContainer()
}

Deno.test('registerTriggerActionJob registers a descriptor, resolvable by actionKind', () => {
  reset()

  const handler = () => {}
  registerTriggerActionJob('mail', { name: 'custom-mail-job', processingQueue: 'soft', handler })

  const resolved = ProgramModule.triggerActionJobs.resolve('mail')
  assertEquals(resolved?.name, 'custom-mail-job')
  assertEquals(resolved?.processingQueue, 'soft')
  assertEquals(resolved?.handler, handler)

  reset()
})

Deno.test('registerTriggerActionJob throws when actionKind is already registered', () => {
  reset()

  registerTriggerActionJob('mail', { name: 'first-job', handler: () => {} })

  assertThrows(
    () => registerTriggerActionJob('mail', { name: 'second-job', handler: () => {} }),
    Error,
    'already mapped to job "first-job"',
  )

  reset()
})

Deno.test('getRegisteredTriggerActionJobs returns every registered descriptor', () => {
  reset()

  registerTriggerActionJob('mail', { name: 'mail-job', handler: () => {} })
  registerTriggerActionJob('request', { name: 'request-job', handler: () => {} })

  const all = getRegisteredTriggerActionJobs()
  assertEquals(all.length, 2)
  assertEquals(
    new Set(all.map((d) => d.actionKind)),
    new Set(['mail', 'request']),
  )
  assertEquals(
    new Set(all.map((d) => d.name)),
    new Set(['mail-job', 'request-job']),
  )

  reset()
})

Deno.test('getRegisteredTriggerActionJobs returns an empty array when nothing registered', () => {
  reset()

  assertEquals(getRegisteredTriggerActionJobs(), [])
})
