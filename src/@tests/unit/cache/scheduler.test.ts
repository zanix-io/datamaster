// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { RedisPipelineScheduler } from 'cache/providers/redis/connector/scheduler.ts'
import logger from '@zanix/logger'

/** A minimal fake `RedisClientType` — only `multi().set(...).exec()` is exercised. */
const fakeClient = (exec: () => Promise<unknown>) => ({
  multi: () => ({
    set: () => undefined,
    exec,
  }),
})

Deno.test('flush is a no-op when nothing is queued', async () => {
  let execCalls = 0
  const client = fakeClient(() => {
    execCalls++
    return Promise.resolve()
  })

  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn())
  await scheduler.flush()

  assertEquals(execCalls, 0)
})

Deno.test('flush is a no-op when a flush is already in progress', async () => {
  let execCalls = 0
  let resolveExec: () => void = () => {}
  const client = fakeClient(() => {
    execCalls++
    return new Promise((resolve) => {
      resolveExec = () => resolve(undefined)
    })
  })

  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn())
  scheduler.addSet('key', 'value')

  const firstFlush = scheduler.flush()
  // The first flush() is now in flight (flushing = true, exec() still pending) — a concurrent
  // second call must return immediately instead of racing it.
  await scheduler.flush()
  assertEquals(execCalls, 1)

  resolveExec()
  await firstFlush
})

Deno.test('flush logs and swallows an error instead of throwing', async () => {
  const client = fakeClient(() => Promise.reject(new Error('redis exec failed')))
  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn())
  scheduler.addSet('key', 'value')

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    await scheduler.flush()
    assertEquals(errors.length, 1)
    assertEquals(
      (errors[0] as unknown[])[0],
      '[RedisPipelineScheduler] Pipeline flush error:',
    )
  } finally {
    logger.error = originalError
  }
})

Deno.test('flush resets counter/flushing state even after an error', async () => {
  let execCalls = 0
  let shouldFail = true
  const client = fakeClient(() => {
    execCalls++
    return shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve()
  })
  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn())
  scheduler.addSet('key', 'value')

  const originalError = logger.error.bind(logger)
  logger.error = (() => undefined) as any

  try {
    await scheduler.flush()
    assertEquals(execCalls, 1)

    // A prior failure must not leave `flushing`/`counter` stuck on this same instance — a later
    // flush with something newly queued must still run exec(), not be skipped by the same guard
    // that makes an empty/already-flushing flush() a no-op.
    shouldFail = false
    scheduler.addSet('key2', 'value2')
    await scheduler.flush()
    assertEquals(execCalls, 2)
  } finally {
    logger.error = originalError
  }
})

Deno.test('addSet triggers an immediate flush once maxBatch is reached', async () => {
  let execCalls = 0
  const client = fakeClient(() => {
    execCalls++
    return Promise.resolve()
  })

  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn(), {
    maxBatch: 1,
  })
  scheduler.addSet('key', 'value')

  // The triggered flush() is fire-and-forget (`void this.flush()`) — give it a tick to run.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assertEquals(execCalls, 1)
})

Deno.test('shutdown flushes any pending operations', async () => {
  let execCalls = 0
  const client = fakeClient(() => {
    execCalls++
    return Promise.resolve()
  })

  const scheduler = new RedisPipelineScheduler(client as any, (fn) => fn())
  scheduler.addSet('key', 'value')

  await scheduler.shutdown()

  assertEquals(execCalls, 1)
})
