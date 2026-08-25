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
        { node: 'http://localhost:9200', index: { name: 'worker-logs' } },
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
    jsonResponse({
      errors: true,
      items: [{ index: { status: 400, error: {} } }],
    })
  )
  try {
    const result = await flushBulkInWorker({ node: 'http://localhost:9200' }, [{
      a: 1,
    }])
    assertEquals(result, { errors: true, failedCount: 1 })
  } finally {
    restore()
  }
})

Deno.test(
  'flushBulkInWorker honors indexInitialize: true by ensuring the index before bulkIndex',
  async () => {
    // Regression coverage for the worker-side analog of the `indexInitialize`-not-wired gap fixed
    // in `flushInline` (`log-adapter.ts`): `flushBulkInWorker` used to construct its connector and
    // call `bulkIndex()` directly, never wiring `indexInitialized` at all — `indexInitialize: true`
    // paired with `useWorker` was silently a no-op. Fixed via the same `wireIndexInitialize`
    // extracted in `connector.ts`.
    const calls: { method: string }[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((_url: string | URL, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? 'GET' })
      if (init.method === 'HEAD') return Promise.resolve(new Response(null, { status: 200 }))
      return Promise.resolve(jsonResponse({ errors: false, items: [] }))
    }) as typeof fetch
    try {
      const result = await flushBulkInWorker(
        {
          node: 'http://localhost:9200',
          index: { name: 'worker-logs' },
          indexInitialize: true,
        },
        [{ message: 'from worker' }],
      )
      assertEquals(result, { errors: false, failedCount: 0 })
      assertEquals(calls.filter((c) => c.method === 'HEAD').length, 1)
    } finally {
      globalThis.fetch = original
    }
  },
)

Deno.test(
  'flushBulkInWorker re-checks the index on every call — no cross-call singleton to memoize against',
  async () => {
    // Unlike the main-thread `getConnector()` path (a reused singleton connector, memoized via a
    // `WeakSet`), every `flushBulkInWorker` call constructs a brand-new, throwaway connector — so
    // `ensureIndex()`'s HEAD check legitimately re-runs on each call. Still correct (idempotent,
    // never touches an existing index) — this documents the real, structural difference rather
    // than asserting a false "only once ever" expectation for this code path.
    const calls: { method: string }[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((_url: string | URL, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? 'GET' })
      if (init.method === 'HEAD') return Promise.resolve(new Response(null, { status: 200 }))
      return Promise.resolve(jsonResponse({ errors: false, items: [] }))
    }) as typeof fetch
    try {
      for (let i = 0; i < 2; i++) {
        // deno-lint-ignore no-await-in-loop
        await flushBulkInWorker(
          { node: 'http://localhost:9200', index: { name: 'worker-logs' }, indexInitialize: true },
          [{ message: `call-${i}` }],
        )
      }
      assertEquals(calls.filter((c) => c.method === 'HEAD').length, 2)
    } finally {
      globalThis.fetch = original
    }
  },
)
