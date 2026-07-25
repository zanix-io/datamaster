import { assertEquals, assertThrows } from '@std/assert'
import { seederBaseWrapper } from 'database/utils/seeders/wrapper.ts'
import type { SeederProcessor } from 'database/typings/general.ts'

console.error = () => {}
console.warn = () => {}

const buildProcessor = (avoidRun: SeederProcessor['avoidRun'] = () => false) => {
  const calls: unknown[] = []
  const processor: SeederProcessor = {
    avoidRun,
    onFinish: (status, options, model) => {
      calls.push({ status, options, model })
    },
  }
  return { processor, calls }
}

Deno.test('seederBaseWrapper throws when no seeder name can be resolved', () => {
  const { processor } = buildProcessor()

  assertThrows(
    () => seederBaseWrapper(async () => {}, processor, {}),
    Error,
    'Missing required process information',
  )
})

Deno.test('seederBaseWrapper reports failure when the handler throws synchronously', () => {
  const { processor, calls } = buildProcessor()

  const wrapped = seederBaseWrapper(
    () => {
      throw new Error('sync failure')
    },
    processor,
    { name: 'SyncFailingSeeder' },
  )

  wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  const call = calls[0] as { status: string; options: { error?: string } }
  assertEquals(call.status, 'failed')
  assertEquals(call.options.error, 'sync failure')
})

Deno.test('seederBaseWrapper reports success for a synchronous handler', () => {
  const { processor, calls } = buildProcessor()

  const wrapped = seederBaseWrapper(() => {}, processor, { name: 'SyncSeeder' })

  wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  assertEquals((calls[0] as { status: string }).status, 'success')
})

Deno.test('seederBaseWrapper reports success for an async handler', async () => {
  const { processor, calls } = buildProcessor()

  const wrapped = seederBaseWrapper(() => Promise.resolve(), processor, {
    name: 'AsyncSeeder',
  })

  await wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  assertEquals((calls[0] as { status: string }).status, 'success')
})

Deno.test('seederBaseWrapper skips execution when avoidRun returns true', () => {
  const { processor, calls } = buildProcessor(() => true)

  const wrapped = seederBaseWrapper(() => {}, processor, { name: 'SkippedSeeder' })

  const result = wrapped({} as never, {} as never)

  assertEquals(result, undefined)
  assertEquals(calls.length, 0)
})

Deno.test('seederBaseWrapper ignores avoidRun when runningMode is "always"', () => {
  const { processor, calls } = buildProcessor(() => true)

  const wrapped = seederBaseWrapper(() => {}, processor, {
    name: 'AlwaysRunSeeder',
    runningMode: 'always',
  })

  wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  assertEquals((calls[0] as { status: string }).status, 'success')
})

Deno.test('seederBaseWrapper skips logger output when verbose is false', () => {
  const { processor, calls } = buildProcessor()

  const wrapped = seederBaseWrapper(() => {}, processor, {
    name: 'SilentSeeder',
    verbose: false,
  })

  wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  assertEquals((calls[0] as { status: string }).status, 'success')
})

Deno.test('seederBaseWrapper reports failure when the handler rejects', async () => {
  const { processor, calls } = buildProcessor()

  const wrapped = seederBaseWrapper(
    () => Promise.reject(new Error('async failure')),
    processor,
    { name: 'AsyncFailingSeeder' },
  )

  await wrapped({} as never, {} as never)

  assertEquals(calls.length, 1)
  const call = calls[0] as { status: string; options: { error?: string } }
  assertEquals(call.status, 'failed')
  assertEquals(call.options.error, 'async failure')
})
