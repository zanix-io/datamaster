import { assertEquals } from '@std/assert'
import logger from '@zanix/logger'
import { type LogTriggerActionData, writeLogTriggerEntry } from 'modules/triggers/log-trigger.ts'

Deno.test('writeLogTriggerEntry calls logger.info with the message and the dispatched data', () => {
  const calls: unknown[][] = []
  const original = logger.info
  logger.info = ((...args: unknown[]) => {
    calls.push(args)
  }) as typeof logger.info

  try {
    const data = { _data: { id: '1' } }
    writeLogTriggerEntry({ level: 'info', message: 'hello', data })

    assertEquals(calls.length, 1)
    assertEquals(calls[0][0], 'hello')
    assertEquals(calls[0][1], data)
  } finally {
    logger.info = original
  }
})

Deno.test('writeLogTriggerEntry calls logger.error/warn/debug the same way as info', () => {
  const seen: { level: string; args: unknown[] }[] = []
  const originals = {
    error: logger.error,
    warn: logger.warn,
    debug: logger.debug,
  }
  for (const level of ['error', 'warn', 'debug'] as const) {
    // deno-lint-ignore no-explicit-any
    ;(logger as any)[level] = (...args: unknown[]) => seen.push({ level, args })
  }

  try {
    writeLogTriggerEntry({ level: 'error', message: 'oops', data: { a: 1 } })
    writeLogTriggerEntry({ level: 'warn', message: 'careful', data: { b: 2 } })
    writeLogTriggerEntry({ level: 'debug', message: 'trace', data: { c: 3 } })

    assertEquals(seen.length, 3)
    assertEquals(seen[0], { level: 'error', args: ['oops', { a: 1 }] })
    assertEquals(seen[1], { level: 'warn', args: ['careful', { b: 2 }] })
    assertEquals(seen[2], { level: 'debug', args: ['trace', { c: 3 }] })
  } finally {
    logger.error = originals.error
    logger.warn = originals.warn
    logger.debug = originals.debug
  }
})

Deno.test('writeLogTriggerEntry calls logger.success with only the message, no data', () => {
  const calls: unknown[][] = []
  const original = logger.success
  logger.success = ((...args: unknown[]) => {
    calls.push(args)
  }) as typeof logger.success

  try {
    writeLogTriggerEntry({
      level: 'success',
      message: 'done',
      data: { shouldNotBeForwarded: true },
    } as LogTriggerActionData)

    assertEquals(calls.length, 1)
    assertEquals(calls[0], ['done'])
  } finally {
    logger.success = original
  }
})
