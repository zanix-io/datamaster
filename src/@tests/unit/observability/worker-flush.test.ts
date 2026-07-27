import { assertEquals } from '@std/assert'
import { flushBulkInWorker } from 'observability/worker-flush.ts'

/** Installs a fake `fetch` recording every call, restored via the returned function. */
const mockFetch = (handler: () => Response) => {
  const original = globalThis.fetch
  const calls: number[] = []
  globalThis.fetch = (() => {
    calls.push(1)
    return Promise.resolve(handler())
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// `flushBulkInWorker` is what `WorkerManager` re-imports and invokes by name inside a real worker
// thread — it's tested here by calling it directly on the main thread with a mocked `fetch`, since
// a `fetch` mock installed here would never propagate into a real spawned Worker's own global
// scope. The dispatch mechanism itself (`WorkerManager`) is already covered by `@zanix/utils`'s own
// test suite; this only verifies this module's own logic: it builds a throwaway, non-auto-connecting
// connector from the given plain options and delegates straight to `bulkIndex`.

Deno.test({
  name:
    'flushBulkInWorker builds a connector with autoInitialize disabled and bulk-indexes the docs',
  fn: async () => {
    const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
    try {
      const result = await flushBulkInWorker(
        { node: 'http://localhost:9200', index: 'worker-logs' },
        [{ message: 'from worker' }],
      )
      assertEquals(result, { errors: false, failedCount: 0 })
      assertEquals(calls.length, 1)
    } finally {
      restore()
    }
  },
})

Deno.test('flushBulkInWorker surfaces bulk partial failures to its caller', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({ errors: true, items: [{ index: { status: 400, error: {} } }] })
  )
  try {
    const result = await flushBulkInWorker({ node: 'http://localhost:9200' }, [{ a: 1 }])
    assertEquals(result, { errors: true, failedCount: 1 })
  } finally {
    restore()
  }
})
