import { assertEquals } from '@std/assert'
import logger from '@zanix/logger'
import { registerLogTriggerJob } from 'modules/triggers/log-trigger.core.ts'
import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'
import ProgramModule from 'modules/program/mod.ts'

// `log-trigger.core.ts` self-registers `'log'` as a module-load side effect (see its own doc) —
// importing it above already ran that once against the shared `ProgramModule.triggerActionJobs`
// container. Reset it immediately so this file starts from, and leaves, the same clean-container
// state every other trigger-action-jobs test file assumes.
const reset = () => {
  ProgramModule.triggerActionJobs.resetContainer()
}
reset()

Deno.test('registerLogTriggerJob registers "log" against DEFAULT_TRIGGER_JOBS.log', () => {
  reset()

  registerLogTriggerJob()

  const resolved = ProgramModule.triggerActionJobs.resolve('log')
  assertEquals(resolved?.name, DEFAULT_TRIGGER_JOBS.log)
  assertEquals(resolved?.processingQueue, 'soft')

  reset()
})

Deno.test('the registered "log" job handler delegates to writeLogTriggerEntry', () => {
  reset()
  registerLogTriggerJob()

  const calls: unknown[][] = []
  const original = logger.info
  logger.info = ((...args: unknown[]) => {
    calls.push(args)
  }) as typeof logger.info

  try {
    const resolved = ProgramModule.triggerActionJobs.resolve('log')
    resolved?.handler.call({ providers: undefined as never }, {
      level: 'info',
      message: 'via registered handler',
    } as never)

    assertEquals(calls.length, 1)
    assertEquals(calls[0][0], 'via registered handler')
  } finally {
    logger.info = original
    reset()
  }
})
