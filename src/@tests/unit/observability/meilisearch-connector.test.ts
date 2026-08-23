// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { MeilisearchConnector } from 'observability/meilisearch-connector.ts'
import { InternalError } from '@zanix/errors'

console.error = () => {}

/** Installs a fake `fetch` recording every call, restored via the returned function. */
const mockFetch = (handler: (url: string, init: RequestInit) => Response) => {
  const original = globalThis.fetch
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(handler(String(url), init))
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const enqueuedTask = (taskUid = 1) => ({
  taskUid,
  indexUid: 'logs',
  status: 'enqueued',
  type: 'documentAdditionOrUpdate',
})

Deno.test('resolves host from the explicit option over any env var', async () => {
  Deno.env.set('SEARCH_URL', 'http://from-env:7700')
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://from-option:7700',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assertStringIncludes(calls[0].url, 'from-option')
  } finally {
    restore()
    Deno.env.delete('SEARCH_URL')
  }
})

Deno.test('falls back to SEARCH_URL when host is omitted', async () => {
  Deno.env.set('SEARCH_URL', 'http://from-search-url-env:7700')
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false, waitForTask: false })
    await connector.index({ a: 1 })
    assertStringIncludes(calls[0].url, 'from-search-url-env')
  } finally {
    restore()
    Deno.env.delete('SEARCH_URL')
  }
})

Deno.test('defaults to http://localhost:7700 with no option or env var', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false, waitForTask: false })
    await connector.index({ a: 1 })
    assertStringIncludes(calls[0].url, 'localhost:7700')
  } finally {
    restore()
  }
})

Deno.test(
  'index() sends the document wrapped in a one-element array to POST /indexes/{index}/documents',
  async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        index: { name: 'my-index' },
        autoInitialize: false,
        waitForTask: false,
      })
      await connector.index({ message: 'hi' })

      assertStringIncludes(calls[0].url, 'indexes/my-index/documents')
      assertEquals(calls[0].init.method, 'POST')
      assertEquals(JSON.parse(calls[0].init.body as string), [{ message: 'hi' }])
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() sends the whole array to the SAME /indexes/{index}/documents endpoint ' +
    'index() uses — Meilisearch has no distinct bulk endpoint',
  async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        index: { name: 'logs' },
        autoInitialize: false,
        waitForTask: false,
      })
      await connector.bulkIndex([{ a: 1 }, { a: 2 }])

      assertEquals(calls.length, 1)
      assertStringIncludes(calls[0].url, 'indexes/logs/documents')
      assertEquals(calls[0].init.method, 'POST')
      assertEquals(JSON.parse(calls[0].init.body as string), [{ a: 1 }, { a: 2 }])
    } finally {
      restore()
    }
  },
)

Deno.test('bulkIndex() is a no-op (no request sent) for an empty batch', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false })
    const result = await connector.bulkIndex([])
    assertEquals(result, { errors: false, failedCount: 0 })
    assertEquals(calls.length, 0)
  } finally {
    restore()
  }
})

Deno.test(
  'bulkIndex() groups documents by their resolved per-document index and issues one ' +
    'POST per group — a single request cannot target more than one Meilisearch index',
  async () => {
    const { calls, restore } = mockFetch((url) => {
      if (url.includes('logs-error')) return jsonResponse(enqueuedTask(1))
      if (url.includes('logs-info')) return jsonResponse(enqueuedTask(2))
      throw new Error(`unexpected url: ${url}`)
    })
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        index: { name: (doc) => `logs-${doc.level}` },
        autoInitialize: false,
        waitForTask: false,
      })
      const result = await connector.bulkIndex([
        { level: 'error', a: 1 },
        { level: 'info', a: 2 },
        { level: 'error', a: 3 },
      ])

      assertEquals(calls.length, 2)
      const errorCall = calls.find((c) => c.url.includes('logs-error'))
      const infoCall = calls.find((c) => c.url.includes('logs-info'))
      assert(errorCall && infoCall)
      assertEquals(JSON.parse(errorCall.init.body as string), [
        { level: 'error', a: 1 },
        { level: 'error', a: 3 },
      ])
      assertEquals(JSON.parse(infoCall.init.body as string), [{ level: 'info', a: 2 }])
      assertEquals(result, { errors: false, failedCount: 0 })
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() with waitForTask disabled resolves as soon as the write is enqueued, ' +
    'without polling GET /tasks/{taskUid} at all',
  async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        autoInitialize: false,
        waitForTask: false,
      })
      const result = await connector.bulkIndex([{ a: 1 }])
      assertEquals(result, { errors: false, failedCount: 0 })
      assertEquals(calls.length, 1)
      assert(calls.every((c) => !c.url.includes('/tasks/')))
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() with waitForTask enabled (the default) polls the task and reports ' +
    'errors:false once it reaches "succeeded"',
  async () => {
    let pollCount = 0
    const { calls, restore } = mockFetch((_url, init) => {
      if (init.method === 'POST') return jsonResponse(enqueuedTask(42))
      pollCount++
      const status = pollCount < 2 ? 'processing' : 'succeeded'
      return jsonResponse({
        taskUid: 42,
        indexUid: 'logs',
        status,
        type: 'documentAdditionOrUpdate',
      })
    })
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        autoInitialize: false,
        pollIntervalMs: 1,
      })
      const result = await connector.bulkIndex([{ a: 1 }])
      assertEquals(result, { errors: false, failedCount: 0 })
      assert(calls.some((c) => c.url.includes('tasks/42')))
      assertEquals(pollCount, 2)
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() reports failedCount computed from details.indexedDocuments when a task ' +
    'terminally fails and that field IS present',
  async () => {
    const { restore } = mockFetch((_url, init) => {
      if (init.method === 'POST') return jsonResponse(enqueuedTask(7))
      return jsonResponse({
        taskUid: 7,
        indexUid: 'logs',
        status: 'failed',
        type: 'documentAdditionOrUpdate',
        details: { indexedDocuments: 1, receivedDocuments: 3 },
        error: {
          message: 'bad doc',
          code: 'invalid_document_fields',
          type: 'invalid_request',
          link: '',
        },
      })
    })
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        autoInitialize: false,
        pollIntervalMs: 1,
      })
      const result = await connector.bulkIndex([{ a: 1 }, { a: 2 }, { a: 3 }])
      assertEquals(result, { errors: true, failedCount: 2 })
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() conservatively treats the WHOLE group as failed when a task terminally ' +
    'fails with no usable details.indexedDocuments field',
  async () => {
    const { restore } = mockFetch((_url, init) => {
      if (init.method === 'POST') return jsonResponse(enqueuedTask(8))
      return jsonResponse({
        taskUid: 8,
        indexUid: 'logs',
        status: 'failed',
        type: 'documentAdditionOrUpdate',
        error: { message: 'boom', code: 'internal', type: 'internal', link: '' },
      })
    })
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        autoInitialize: false,
        pollIntervalMs: 1,
      })
      const result = await connector.bulkIndex([{ a: 1 }, { a: 2 }])
      assertEquals(result, { errors: true, failedCount: 2 })
    } finally {
      restore()
    }
  },
)

Deno.test(
  'bulkIndex() throws if the task never reaches a terminal status within pollTimeoutMs — ' +
    'never fabricates a result for an outcome it does not actually know',
  async () => {
    const { restore } = mockFetch((_url, init) => {
      if (init.method === 'POST') return jsonResponse(enqueuedTask(9))
      return jsonResponse({
        taskUid: 9,
        indexUid: 'logs',
        status: 'processing',
        type: 'documentAdditionOrUpdate',
      })
    })
    try {
      const connector = new MeilisearchConnector({
        host: 'http://localhost:7700',
        autoInitialize: false,
        pollIntervalMs: 1,
        pollTimeoutMs: 5,
      })
      // Specifically `InternalError`, not just any `Error` — locks in the fix that replaced a
      // plain `Error` here (a downstream service not finishing in time, not the caller's fault).
      const error = await assertRejects(
        () => connector.bulkIndex([{ a: 1 }]),
        InternalError,
        'did not reach a terminal status',
      )
      assertEquals(error.code, 'MEILISEARCH_TASK_POLL_TIMEOUT')
    } finally {
      restore()
    }
  },
)

Deno.test('index() never polls a task — its contract is fire-and-enqueue only', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      autoInitialize: false,
    })
    await connector.index({ a: 1 })
    assertEquals(calls.length, 1)
    assert(!calls[0].url.includes('/tasks/'))
  } finally {
    restore()
  }
})

Deno.test('a configured primaryKey is sent as a query param on document writes', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      index: { name: 'logs', primaryKey: 'uuid' },
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ uuid: 'abc' })
    assertStringIncludes(calls[0].url, 'primaryKey=uuid')
  } finally {
    restore()
  }
})

Deno.test('no primaryKey query param is sent when it is not configured', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assert(!calls[0].url.includes('primaryKey'))
  } finally {
    restore()
  }
})

Deno.test('an apiKey option is sent as an Authorization: Bearer header', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      apiKey: 'my-master-key',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, 'Bearer my-master-key')
  } finally {
    restore()
  }
})

Deno.test('falls back to MEILISEARCH_API_KEY when apiKey is omitted', async () => {
  Deno.env.set('MEILISEARCH_API_KEY', 'env-key')
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, 'Bearer env-key')
  } finally {
    restore()
    Deno.env.delete('MEILISEARCH_API_KEY')
  }
})

Deno.test('an explicit apiKey option wins over MEILISEARCH_API_KEY', async () => {
  Deno.env.set('MEILISEARCH_API_KEY', 'env-key')
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      apiKey: 'option-key',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, 'Bearer option-key')
  } finally {
    restore()
    Deno.env.delete('MEILISEARCH_API_KEY')
  }
})

Deno.test('sends no Authorization header when apiKey and its env var are unset', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, undefined)
  } finally {
    restore()
  }
})

Deno.test('checkHealth() returns true when the instance responds "available"', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ status: 'available' }))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false })
    assertEquals(await connector.checkHealth(), true)
    assertStringIncludes(calls[0].url, 'health')
  } finally {
    restore()
  }
})

Deno.test('checkHealth() returns false when the instance reports "mustRestart"', async () => {
  const { restore } = mockFetch(() => jsonResponse({ status: 'mustRestart' }))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false })
    assertEquals(await connector.checkHealth(), false)
  } finally {
    restore()
  }
})

Deno.test('checkHealth() returns false when the request fails', async () => {
  const { restore } = mockFetch(() => new Response('down', { status: 503 }))
  try {
    const connector = new MeilisearchConnector({ autoInitialize: false })
    assertEquals(await connector.checkHealth(), false)
  } finally {
    restore()
  }
})

Deno.test('a per-call index option overrides the connector-level default index', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(enqueuedTask()))
  try {
    const connector = new MeilisearchConnector({
      host: 'http://localhost:7700',
      index: { name: 'default-index' },
      autoInitialize: false,
      waitForTask: false,
    })
    await connector.index({ a: 1 }, { index: 'call-level-index' })
    assertStringIncludes(calls[0].url, 'indexes/call-level-index/documents')
  } finally {
    restore()
  }
})
