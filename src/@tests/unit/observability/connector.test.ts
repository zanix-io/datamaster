// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { getConnector, ZanixElasticsearchConnector } from 'observability/connector.ts'
import { ProgramModule } from '@zanix/server'
import logger from '@zanix/logger'

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

Deno.test('resolves node from the explicit option over any env var', async () => {
  Deno.env.set('SEARCH_URL', 'http://from-env:9200')
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://from-option:9200',
      autoInitialize: false,
    })
    await connector.index({ a: 1 })
    assertStringIncludes(calls[0].url, 'from-option')
  } finally {
    restore()
    Deno.env.delete('SEARCH_URL')
  }
})

Deno.test({
  name: 'falls back to SEARCH_URL when node is omitted',
  fn: async () => {
    const { calls, restore } = mockFetch(() => jsonResponse({}))
    try {
      Deno.env.set('SEARCH_URL', 'http://from-search-url:9200')
      const connector = new ZanixElasticsearchConnector({
        autoInitialize: false,
      })
      await connector.index({ a: 1 })
      assertStringIncludes(calls[0].url, 'from-search-url')
    } finally {
      restore()
      Deno.env.delete('SEARCH_URL')
    }
  },
})

Deno.test('defaults to http://localhost:9200 with no option or env var', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    await connector.index({ a: 1 })
    assertStringIncludes(calls[0].url, 'localhost:9200')
  } finally {
    restore()
  }
})

Deno.test('index() sends the document to POST /{index}/_doc', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ _id: '1' }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'my-index' },
      autoInitialize: false,
    })
    await connector.index({ message: 'hi' })

    assertStringIncludes(calls[0].url, 'my-index/_doc')
    assertEquals(JSON.parse(calls[0].init.body as string), { message: 'hi' })
  } finally {
    restore()
  }
})

Deno.test('bulkIndex() builds NDJSON with one action+doc line pair per document', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'logs' },
      autoInitialize: false,
    })
    await connector.bulkIndex([{ a: 1 }, { a: 2 }])

    assertStringIncludes(calls[0].url, '_bulk')
    assertEquals(calls[0].init.headers, {
      'Content-Type': 'application/x-ndjson',
    })

    const lines = (calls[0].init.body as string).split('\n')
    assertEquals(lines, [
      JSON.stringify({ index: { _index: 'logs' } }),
      JSON.stringify({ a: 1 }),
      JSON.stringify({ index: { _index: 'logs' } }),
      JSON.stringify({ a: 2 }),
      '',
    ])
  } finally {
    restore()
  }
})

Deno.test('bulkIndex() reports no failures when the response has none', async () => {
  const { restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    const result = await connector.bulkIndex([{ a: 1 }])
    assertEquals(result, { errors: false, failedCount: 0 })
  } finally {
    restore()
  }
})

Deno.test('bulkIndex() counts per-item failures even on an HTTP 200 response', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({
      errors: true,
      items: [
        { index: { status: 201 } },
        { index: { status: 400, error: { type: 'mapper_parsing_exception' } } },
      ],
    })
  )
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    const result = await connector.bulkIndex([{ a: 1 }, { a: 'not-a-number' }])
    assertEquals(result, { errors: true, failedCount: 1 })
  } finally {
    restore()
  }
})

Deno.test('bulkIndex() is a no-op for an empty batch (no request sent)', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    const result = await connector.bulkIndex([])
    assertEquals(result, { errors: false, failedCount: 0 })
    assertEquals(calls.length, 0)
  } finally {
    restore()
  }
})

Deno.test('search() queries the connector-level default index by default', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ hits: { total: { value: 0 } } }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'logs' },
      autoInitialize: false,
    })
    await connector.search({ query: { match_all: {} } })

    assertStringIncludes(calls[0].url, 'logs/_search')
    assertEquals(JSON.parse(calls[0].init.body as string), {
      query: { match_all: {} },
    })
  } finally {
    restore()
  }
})

Deno.test('search() accepts a per-call index overriding the connector-level default', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ hits: { total: { value: 0 } } }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'default-index' },
      autoInitialize: false,
    })
    await connector.search({ query: { match_all: {} } }, {
      index: 'other-index',
    })

    assertStringIncludes(calls[0].url, 'other-index/_search')
  } finally {
    restore()
  }
})

Deno.test('search() defaults to cluster-wide when the default index is a resolver fn', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ hits: { total: { value: 0 } } }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: (doc) => `logs-${doc.level}` },
      autoInitialize: false,
    })
    await connector.search({ query: { match_all: {} } })

    assertEquals(calls[0].url, 'http://localhost:9200/_search')
  } finally {
    restore()
  }
})

Deno.test('refresh() targets the connector-level default index by default', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'logs' },
      autoInitialize: false,
    })
    await connector.refresh()

    assertStringIncludes(calls[0].url, 'logs/_refresh')
  } finally {
    restore()
  }
})

Deno.test('refresh() accepts a per-call index overriding the connector-level default', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'default-index' },
      autoInitialize: false,
    })
    await connector.refresh({ index: 'other-index' })

    assertStringIncludes(calls[0].url, 'other-index/_refresh')
  } finally {
    restore()
  }
})

Deno.test('refresh() targets every index when the default index is a resolver fn', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: (doc) => `logs-${doc.level}` },
      autoInitialize: false,
    })
    await connector.refresh()

    assertEquals(calls[0].url, 'http://localhost:9200/_refresh')
  } finally {
    restore()
  }
})

Deno.test('checkClusterHealth() returns true when the cluster responds', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ status: 'green' }))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    assertEquals(await connector.checkClusterHealth(), true)
    assertStringIncludes(calls[0].url, '_cluster/health')
  } finally {
    restore()
  }
})

Deno.test('checkClusterHealth() returns false when the request fails', async () => {
  const { restore } = mockFetch(() => new Response('down', { status: 503 }))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    assertEquals(await connector.checkClusterHealth(), false)
  } finally {
    restore()
  }
})

Deno.test('basic auth is sent as an Authorization header', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
      auth: { username: 'user', password: 'pass' },
    })
    await connector.index({ a: 1 })
    assertEquals(
      (calls[0].init.headers as any).Authorization,
      `Basic ${btoa('user:pass')}`,
    )
  } finally {
    restore()
  }
})

Deno.test('API key auth is sent as an Authorization header', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
      auth: { apiKey: 'my-key' },
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, 'ApiKey my-key')
  } finally {
    restore()
  }
})

Deno.test('an explicit auth option wins over the API key env vars', async () => {
  Deno.env.set('ELASTICSEARCH_API_KEY', 'env-key')
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
      auth: { apiKey: 'option-key' },
    })
    await connector.index({ a: 1 })
    assertEquals(
      (calls[0].init.headers as any).Authorization,
      'ApiKey option-key',
    )
  } finally {
    restore()
    Deno.env.delete('ELASTICSEARCH_API_KEY')
  }
})

Deno.test('falls back to the API key env vars, in order, when auth is omitted', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    Deno.env.set('OPENSEARCH_API_KEY', 'from-opensearch-key')
    const connectorFromOpenSearch = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    await connectorFromOpenSearch.index({ a: 1 })
    assertEquals(
      (calls[0].init.headers as any).Authorization,
      'ApiKey from-opensearch-key',
    )

    Deno.env.set('ELASTICSEARCH_API_KEY', 'from-elasticsearch-key')
    const connectorFromElasticsearch = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    await connectorFromElasticsearch.index({ a: 1 })
    assertEquals(
      (calls[1].init.headers as any).Authorization,
      'ApiKey from-elasticsearch-key',
    )
  } finally {
    restore()
    Deno.env.delete('ELASTICSEARCH_API_KEY')
    Deno.env.delete('OPENSEARCH_API_KEY')
  }
})

Deno.test('sends no Authorization header when auth and its env vars are unset', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
    })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, undefined)
  } finally {
    restore()
  }
})

// The "basic-auth credentials embedded in the node URL reach the server" test moved to
// `integration/observability/connector-basic-auth.test.ts` — it spins up a real local HTTP
// server + real `fetch`, which never belongs in `unit/` regardless of the ephemeral port used.

Deno.test('a per-call index option overrides the connector-level default index', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'default-index' },
      autoInitialize: false,
    })
    await connector.index({ a: 1 }, { index: 'call-level-index' })
    assertStringIncludes(calls[0].url, 'call-level-index/_doc')

    await connector.bulkIndex([{ a: 1 }], { index: 'bulk-call-level-index' })
    assertStringIncludes(calls[1].init.body as string, 'bulk-call-level-index')
  } finally {
    restore()
  }
})

Deno.test(
  'a per-call index option also accepts a per-document resolver function, not just a static string',
  async () => {
    // `bulkIndex()`'s (and `index()`'s) `opts.index` accept the same shape the connector-level
    // default already does — a static name or a per-document resolver — so a per-call override
    // can route different documents in the same batch to different indexes too. This is what
    // lets `elasticsearchLogSave`'s own `flushInline` (`log-adapter.ts`) forward a
    // function-shaped `index.name` through to the shared 'search' core connector's actual write,
    // not just a static name.
    const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
    try {
      const connector = new ZanixElasticsearchConnector({
        node: 'http://localhost:9200',
        index: { name: 'connector-default' },
        autoInitialize: false,
      })
      await connector.bulkIndex(
        [{ level: 'error' }, { level: 'info' }],
        { index: (doc) => `logs-${(doc as { level: string }).level}` },
      )

      const body = calls[0].init.body as string
      assertStringIncludes(body, JSON.stringify({ index: { _index: 'logs-error' } }))
      assertStringIncludes(body, JSON.stringify({ index: { _index: 'logs-info' } }))
    } finally {
      restore()
    }
  },
)

Deno.test('index accepts a per-document resolver function', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
      index: { name: (doc) => `logs-${doc.level}` },
    })
    await connector.index({ level: 'error' })
    assertStringIncludes(calls[0].url, 'logs-error/_doc')
  } finally {
    restore()
  }
})

Deno.test('ensureIndex() PUTs settings/mappings to create a missing index', async () => {
  const { calls, restore } = mockFetch((_url, init) => {
    if (init.method === 'HEAD') return new Response(null, { status: 404 })
    return jsonResponse({ acknowledged: true })
  })
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: {
        name: 'logs',
        settings: { number_of_shards: 1 },
        mappings: { properties: { level: { type: 'keyword' } } },
      },
      autoInitialize: false,
    })
    const result = await connector.ensureIndex('logs')

    assertEquals(result, true)
    assertEquals(calls.length, 2)
    assertEquals(calls[0].init.method, 'HEAD')
    assertStringIncludes(calls[0].url, 'logs')
    assertEquals(calls[1].init.method, 'PUT')
    assertStringIncludes(calls[1].url, 'logs')
    assertEquals(JSON.parse(calls[1].init.body as string), {
      settings: { number_of_shards: 1 },
      mappings: { properties: { level: { type: 'keyword' } } },
    })
  } finally {
    restore()
  }
})

Deno.test('ensureIndex() is a no-op (no PUT) when the index already exists', async () => {
  const { calls, restore } = mockFetch(() => new Response(null, { status: 200 }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    const result = await connector.ensureIndex('logs')

    assertEquals(result, true)
    assertEquals(calls.length, 1)
    assertEquals(calls[0].init.method, 'HEAD')
  } finally {
    restore()
  }
})

Deno.test('ensureIndex() checks/creates each index in an array, deduping repeats', async () => {
  const { calls, restore } = mockFetch((_url, init) => {
    if (init.method === 'HEAD') return new Response(null, { status: 404 })
    return jsonResponse({ acknowledged: true })
  })
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    await connector.ensureIndex(['logs-a', 'logs-b', 'logs-a'])

    const heads = calls.filter((c) => c.init.method === 'HEAD')
    const puts = calls.filter((c) => c.init.method === 'PUT')
    assertEquals(heads.length, 2)
    assertEquals(puts.length, 2)
    assert(heads.some((c) => c.url.includes('logs-a')))
    assert(heads.some((c) => c.url.includes('logs-b')))
  } finally {
    restore()
  }
})

Deno.test('ensureIndex() per-call options override the connector-level settings', async () => {
  const { calls, restore } = mockFetch((_url, init) => {
    if (init.method === 'HEAD') return new Response(null, { status: 404 })
    return jsonResponse({})
  })
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'logs', settings: { number_of_shards: 1 } },
      autoInitialize: false,
    })
    await connector.ensureIndex('logs', { settings: { number_of_shards: 3 } })

    const put = calls.find((c) => c.init.method === 'PUT')
    assertEquals(JSON.parse(put?.init.body as string).settings, {
      number_of_shards: 3,
    })
  } finally {
    restore()
  }
})

Deno.test("ensureIndex() logs success under 'elastic search core' for that class", async () => {
  const { restore } = mockFetch(() => new Response(null, { status: 200 }))
  const messages: unknown[][] = []
  const original = logger.success
  logger.success = ((...args: unknown[]) => {
    messages.push(args)
  }) as any
  try {
    // A class named like the anonymous connector `core.ts` decorates for the `'search'` core slot
    // — `ensureIndex()` special-cases this name into a friendlier log message (see
    // `connector.ts`'s
    // constructor).
    class _ZanixElasticsearchCoreConnector extends ZanixElasticsearchConnector {}
    const connector = new _ZanixElasticsearchCoreConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    await connector.ensureIndex('logs')
    assertStringIncludes(
      String(messages[0]?.[0]),
      "'elastic search core' class",
    )
  } finally {
    logger.success = original
    restore()
  }
})

Deno.test('indexInitialized setter is awaited before index() issues its request', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: 'logs' },
      autoInitialize: false,
    })
    const seen: (string | string[])[] = []
    connector.indexInitialized = (index) => {
      seen.push(index)
      return Promise.resolve(true)
    }
    await connector.index({ a: 1 })
    assertEquals(seen, ['logs'])
    assertStringIncludes(calls[0].url, 'logs/_doc')
  } finally {
    restore()
  }
})

Deno.test('indexInitialized setter is awaited before bulkIndex(), given every index', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: { name: (doc) => `logs-${doc.level}` },
      autoInitialize: false,
    })
    const seen: (string | string[])[] = []
    connector.indexInitialized = (index) => {
      seen.push(index)
      return Promise.resolve(true)
    }
    await connector.bulkIndex([{ level: 'a' }, { level: 'b' }])
    assertEquals(seen, [['logs-a', 'logs-b']])
    assertEquals(calls.length, 1)
  } finally {
    restore()
  }
})

Deno.test('getConnector() throws (no silent fallback) when nothing resolves for "search"', () => {
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = proto.getConnectors
  proto.getConnectors = () => ({
    get: () => {
      throw new Error('missing core connector slot')
    },
  })
  try {
    assertThrows(
      () =>
        getConnector({
          node: 'http://localhost:9200',
          autoInitialize: false,
        }),
      Error,
      'missing core connector slot',
    )
  } finally {
    proto.getConnectors = original
  }
})

Deno.test('getConnector() reuses the connector ProgramModule resolves for "search"', () => {
  const registered = new ZanixElasticsearchConnector({ autoInitialize: false })
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = proto.getConnectors
  proto.getConnectors = () => ({ get: () => registered })
  try {
    const connector = getConnector({ autoInitialize: false })
    assertEquals(connector, registered)
  } finally {
    proto.getConnectors = original
  }
})

Deno.test('getConnector() wires indexInitialized to ensureIndex when enabled', async () => {
  const { calls, restore } = mockFetch(() => new Response(null, { status: 200 }))
  // Real registered connector (not the removed fallback-construction path — see
  // `getConnector()`'s own doc on why that fallback was removed) — `indexInitialize`'s wiring
  // applies to whatever connector actually resolves, registered or not.
  const registered = new ZanixElasticsearchConnector({
    node: 'http://localhost:9200',
    autoInitialize: false,
  })
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = proto.getConnectors
  proto.getConnectors = () => ({ get: () => registered })
  try {
    const connector = getConnector({
      index: { name: 'logs' },
      indexInitialize: true,
      autoInitialize: false,
    })
    const result = await connector.indexInitialized('logs')

    assertEquals(result, true)
    assertEquals(calls.length, 1)
    assertEquals(calls[0].init.method, 'HEAD')
    assertStringIncludes(calls[0].url, 'logs')
  } finally {
    proto.getConnectors = original
    restore()
  }
})

Deno.test(
  'getConnector() only wires ensureIndex once across repeated resolutions of the same connector',
  async () => {
    // `flushInline()` calls `getConnector()` fresh on every flush cycle rather than once at
    // setup, even though the resolved connector is the same reused core singleton every time —
    // `getConnector()` must not unconditionally reassign `indexInitialized` back to a fresh
    // "call ensureIndex() again" closure on each of those calls, which would discard the no-op
    // the first successful run already installed.
    const { calls, restore } = mockFetch(() => new Response(null, { status: 200 }))
    const registered = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    const proto = Object.getPrototypeOf(ProgramModule)
    const original = proto.getConnectors
    proto.getConnectors = () => ({ get: () => registered })

    const messages: unknown[][] = []
    const originalSuccess = logger.success
    logger.success = ((...args: unknown[]) => {
      messages.push(args)
    }) as any
    try {
      // Simulates 3 independent flush cycles, each re-resolving the connector via getConnector().
      for (let i = 0; i < 3; i++) {
        const connector = getConnector({
          index: { name: 'logs' },
          indexInitialize: true,
          autoInitialize: false,
        })
        // deno-lint-ignore no-await-in-loop
        const result = await connector.indexInitialized('logs')
        assertEquals(result, true)
      }

      assertEquals(calls.length, 1)
      assertEquals(calls[0].init.method, 'HEAD')
      assertEquals(messages.length, 1)
    } finally {
      proto.getConnectors = original
      logger.success = originalSuccess
      restore()
    }
  },
)

Deno.test(
  "getConnector()'s memoization is scoped per connector instance, not a shared module-level flag",
  async () => {
    // The `'search'` core slot supports being re-registered with a fresh connector instance
    // during the app's lifetime (see `registerElasticsearchConnector()`/
    // `registerMeilisearchConnector()`'s own doc in `observability/core.ts`, re-invoked after
    // clearing the `'type:connector'` registry — the same swap mechanism this simulates by
    // making `ProgramModule.getConnectors()` resolve a second, entirely distinct connector
    // instance). `ensureIndex()` re-runs are gated per connector instance — a WeakSet keyed on
    // the connector object, not a shared boolean — so swapping in a fresh instance (a
    // consumer-supplied custom connector included) still runs its own initialization, and never
    // inherits a *different* instance's already-initialized state.
    const { calls, restore } = mockFetch(() => new Response(null, { status: 200 }))
    const first = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    const second = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      autoInitialize: false,
    })
    const proto = Object.getPrototypeOf(ProgramModule)
    const original = proto.getConnectors

    const messages: unknown[][] = []
    const originalSuccess = logger.success
    logger.success = ((...args: unknown[]) => {
      messages.push(args)
    }) as any
    try {
      // First connector resolves and gets wired/ensured, twice in a row (2 simulated flushes).
      proto.getConnectors = () => ({ get: () => first })
      for (let i = 0; i < 2; i++) {
        const connector = getConnector({
          index: { name: 'logs' },
          indexInitialize: true,
          autoInitialize: false,
        })
        // deno-lint-ignore no-await-in-loop
        await connector.indexInitialized('logs')
      }
      assertEquals(calls.length, 1)
      assertEquals(messages.length, 1)

      // The slot is now re-registered/swapped to a genuinely different connector instance
      // (never wired before) — its own initialization must still run, exactly once, rather than
      // silently inheriting `first`'s already-initialized state.
      proto.getConnectors = () => ({ get: () => second })
      for (let i = 0; i < 2; i++) {
        const connector = getConnector({
          index: { name: 'logs' },
          indexInitialize: true,
          autoInitialize: false,
        })
        assertEquals(connector, second)
        // deno-lint-ignore no-await-in-loop
        await connector.indexInitialized('logs')
      }

      // One additional real HEAD request/success log — `second`'s own, independent of `first`'s.
      assertEquals(calls.length, 2)
      assertEquals(messages.length, 2)

      // `first` itself remains permanently memoized — swapping away from it and back doesn't
      // resurrect repeat calls against it either.
      assertEquals(await first.indexInitialized('logs'), true)
      assertEquals(calls.length, 2)
    } finally {
      proto.getConnectors = original
      logger.success = originalSuccess
      restore()
    }
  },
)

Deno.test('getConnector() leaves indexInitialized as the default no-op when disabled', async () => {
  const { calls, restore } = mockFetch(() => new Response(null, { status: 200 }))
  const registered = new ZanixElasticsearchConnector({
    node: 'http://localhost:9200',
    autoInitialize: false,
  })
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = proto.getConnectors
  proto.getConnectors = () => ({ get: () => registered })
  try {
    const connector = getConnector({
      autoInitialize: false,
    })
    const result = await connector.indexInitialized('logs')

    assertEquals(result, true)
    assertEquals(calls.length, 0)
  } finally {
    proto.getConnectors = original
    restore()
  }
})
