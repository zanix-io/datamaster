// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes } from '@std/assert'
import { Logger } from '@zanix/logger'
import { WorkerManager } from '@zanix/workers'
import { ProgramModule } from '@zanix/server'
import { elasticsearchLogSave } from 'observability/log-adapter.ts'

/**
 * Stubs `ProgramModule.getProviders` (via its prototype — the exported singleton is frozen, so a
 * direct property assignment throws) so `useWorker: 'persisted'` resolves a fake `'worker'` core
 * provider instead of hitting the real DI container, which has no provider registered outside a
 * booted Zanix Application.
 */
const stubWorkerProvider = (
  executeGeneralTask: (fn: (...args: any[]) => unknown, options: {
    callback?: (result: { response?: unknown; error?: unknown }) => void
  }) => (...args: any[]) => void,
) => {
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = proto.getProviders
  proto.getProviders = () => ({ get: () => ({ executeGeneralTask }) })
  return () => (proto.getProviders = original)
}

/** Installs a fake `fetch` capturing every `_bulk` request body, restored via the returned function. */
const mockFetch = (handler: () => Response) => {
  const original = globalThis.fetch
  const bodies: Record<string, unknown>[][] = []
  globalThis.fetch = ((_url: string | URL, init: RequestInit = {}) => {
    const lines = (init.body as string).trim().split('\n')
    const docs = lines.filter((_, i) => i % 2 === 1).map((line) => JSON.parse(line))
    bodies.push(docs)
    return Promise.resolve(handler())
  }) as typeof fetch
  return { bodies, restore: () => (globalThis.fetch = original) }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Fakes a Logger `SaveDataFunction` invocation context around a plain formatted-log object. */
const contextFor = (log: Record<string, unknown>) => ({
  getFmtLog: () => log as any,
})

Deno.test('aliases an existing `timestamp` field to `@timestamp` without removing it', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
    })
    save(
      contextFor({
        timestamp: '2026-07-22T21:56:34.403Z',
        level: 'info',
      }) as any,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(bodies[0], [{
      timestamp: '2026-07-22T21:56:34.403Z',
      level: 'info',
      '@timestamp': '2026-07-22T21:56:34.403Z',
    }])
  } finally {
    restore()
  }
})

Deno.test('leaves an already-present `@timestamp` untouched', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
    })
    save(
      contextFor({
        '@timestamp': '2020-01-01T00:00:00.000Z',
        timestamp: '2026-07-22T00:00:00.000Z',
      }) as any,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(
      (bodies[0][0] as any)['@timestamp'],
      '2020-01-01T00:00:00.000Z',
    )
  } finally {
    restore()
  }
})

Deno.test('synthesizes `@timestamp` only when no timestamp field is present at all', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
    })
    save(contextFor({ level: 'info', message: 'no timestamp here' }) as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const doc = bodies[0][0] as any
    assertEquals(typeof doc['@timestamp'], 'string')
    assertEquals(doc.level, 'info')
  } finally {
    restore()
  }
})

Deno.test('addTimestampField: false skips the aliasing entirely', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
      addTimestampField: false,
    })
    save(contextFor({ timestamp: '2026-07-22T21:56:34.403Z' }) as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(bodies[0], [{ timestamp: '2026-07-22T21:56:34.403Z' }])
  } finally {
    restore()
  }
})

Deno.test('flush() manually sends whatever is currently buffered', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { flushIntervalMs: 100_000 },
    })
    save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
    assertEquals(bodies.length, 0)

    await save.flush()
    assertEquals(bodies.length, 1)
  } finally {
    restore()
  }
})

Deno.test({
  name: 'a failed flush is reported via logger.error with the noSave sentinel and never throws',
  fn: async () => {
    const originalError = (Logger.prototype as any).error
    const calls: unknown[][] = []
    ;(Logger.prototype as any).error = (...args: unknown[]) => calls.push(args)

    const { restore } = mockFetch(() => new Response('down', { status: 503 }))
    try {
      const save = elasticsearchLogSave({
        node: 'http://localhost:9200',
        bulk: { maxSize: 1 },
      })
      save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
      await new Promise((resolve) => setTimeout(resolve, 0))

      assertEquals(calls.length, 1)
      assertStringIncludes(calls[0][0] as string, 'Failed to flush logs')
      assertEquals(calls[0][2], 'noSave')
    } finally {
      restore()
      ;(Logger.prototype as any).error = originalError
    }
  },
})

Deno.test({
  name: "useWorker: 'one-time' dispatches the flush through WorkerManager instead of inline",
  fn: async () => {
    const originalTask = WorkerManager.prototype.task
    const invoked: unknown[][] = []
    ;(WorkerManager.prototype as any).task = function (fn: any, options: any) {
      return {
        invoke: (...parameters: unknown[]) => {
          invoked.push(parameters)
          Promise.resolve(fn(...parameters)).then(
            (response) => options.onFinish?.({ response }),
            (error) => options.onFinish?.({ error }),
          )
        },
      }
    }

    const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
    try {
      const save = elasticsearchLogSave({
        node: 'http://localhost:9200',
        bulk: { maxSize: 1 },
        useWorker: 'one-time',
      })
      save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
      await new Promise((resolve) => setTimeout(resolve, 0))

      assertEquals(invoked.length, 1)
      assertEquals(bodies.length, 1)
    } finally {
      restore()
      WorkerManager.prototype.task = originalTask
    }
  },
})

Deno.test({
  name:
    "useWorker: 'persisted' dispatches through the registered worker provider's executeGeneralTask",
  fn: async () => {
    const invoked: unknown[][] = []
    const restoreProvider = stubWorkerProvider((fn, options) => (...args) => {
      invoked.push(args)
      Promise.resolve(fn(...args)).then(
        (response) => options.callback?.({ response }),
        (error) => options.callback?.({ error }),
      )
    })
    const originalTask = WorkerManager.prototype.task
    let fellBackToOneTime = false
    ;(WorkerManager.prototype as any).task = function (...args: unknown[]) {
      fellBackToOneTime = true
      return originalTask.apply(this, args as never)
    }

    const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
    try {
      const save = elasticsearchLogSave({
        node: 'http://localhost:9200',
        bulk: { maxSize: 1 },
        useWorker: 'persisted',
      })
      save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
      await new Promise((resolve) => setTimeout(resolve, 0))

      assertEquals(invoked.length, 1)
      assertEquals(bodies.length, 1)
      assertEquals(fellBackToOneTime, false)
    } finally {
      restore()
      restoreProvider()
      WorkerManager.prototype.task = originalTask
    }
  },
})

Deno.test('a persisted-worker flush failure is reported the same as an inline one', async () => {
  const restoreProvider = stubWorkerProvider((_fn, options) => () => {
    options.callback?.({ error: new Error('persisted worker boom') })
  })

  const originalError = (Logger.prototype as any).error
  const calls: unknown[][] = []
  ;(Logger.prototype as any).error = (...args: unknown[]) => calls.push(args)

  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
      useWorker: 'persisted',
    })
    save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(calls.length, 1)
    assertStringIncludes(calls[0][0] as string, 'Failed to flush logs')
    assertEquals(calls[0][2], 'noSave')
  } finally {
    restoreProvider()
    ;(Logger.prototype as any).error = originalError
  }
})

Deno.test("'persisted' falls back to one-time when no worker provider is registered", async () => {
  const proto = Object.getPrototypeOf(ProgramModule)
  const originalGetProviders = proto.getProviders
  proto.getProviders = () => ({
    get: () => {
      throw new Error('missing core provider slot')
    },
  })

  const originalTask = WorkerManager.prototype.task
  let usedOneTimeFallback = false
  ;(WorkerManager.prototype as any).task = function (_fn: any, options: any) {
    usedOneTimeFallback = true
    return {
      invoke: () => {
        options.onFinish?.({ error: new Error('worker boom') })
      },
    }
  }

  const originalError = (Logger.prototype as any).error
  const calls: unknown[][] = []
  ;(Logger.prototype as any).error = (...args: unknown[]) => calls.push(args)

  try {
    const save = elasticsearchLogSave({
      node: 'http://localhost:9200',
      bulk: { maxSize: 1 },
      useWorker: 'persisted',
    })
    save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(usedOneTimeFallback, true)
    assertEquals(calls.length, 1)
    assertStringIncludes(calls[0][0] as string, 'Failed to flush logs')
    assertEquals(calls[0][2], 'noSave')
  } finally {
    proto.getProviders = originalGetProviders
    WorkerManager.prototype.task = originalTask
    ;(Logger.prototype as any).error = originalError
  }
})

Deno.test('reuses a provided connector instead of building a new one from options', async () => {
  const { bodies, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const { ZanixElasticsearchConnector } = await import(
      'observability/connector.ts'
    )
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'reused-index' },
      autoInitialize: false,
    })
    const save = elasticsearchLogSave({ connector, bulk: { maxSize: 1 } })
    save(contextFor({ timestamp: '2026-01-01T00:00:00.000Z' }) as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(bodies.length, 1)
  } finally {
    restore()
  }
})
