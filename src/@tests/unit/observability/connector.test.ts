// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes } from '@std/assert'
import { ZanixElasticsearchConnector } from 'observability/connector.ts'

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
  Deno.env.set('ELASTICSEARCH_URL', 'http://from-env:9200')
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
    Deno.env.delete('ELASTICSEARCH_URL')
  }
})

Deno.test({
  name: 'falls back to ELASTICSEARCH_URL, then OPENSEARCH_URL, when node is omitted',
  fn: async () => {
    const { calls, restore } = mockFetch(() => jsonResponse({}))
    try {
      Deno.env.set('OPENSEARCH_URL', 'http://from-opensearch:9200')
      const connectorFromOpenSearch = new ZanixElasticsearchConnector({ autoInitialize: false })
      await connectorFromOpenSearch.index({ a: 1 })
      assertStringIncludes(calls[0].url, 'from-opensearch')

      Deno.env.set('ELASTICSEARCH_URL', 'http://from-elasticsearch:9200')
      const connectorFromElasticsearch = new ZanixElasticsearchConnector({ autoInitialize: false })
      await connectorFromElasticsearch.index({ a: 1 })
      assertStringIncludes(calls[1].url, 'from-elasticsearch')
    } finally {
      restore()
      Deno.env.delete('ELASTICSEARCH_URL')
      Deno.env.delete('OPENSEARCH_URL')
    }
  },
})

Deno.test('defaults to http://localhost:9200 with no option or env var', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
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
      index: 'my-index',
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
      index: 'logs',
      autoInitialize: false,
    })
    await connector.bulkIndex([{ a: 1 }, { a: 2 }])

    assertStringIncludes(calls[0].url, '_bulk')
    assertEquals(calls[0].init.headers, { 'Content-Type': 'application/x-ndjson' })

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
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
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
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
    const result = await connector.bulkIndex([{ a: 1 }, { a: 'not-a-number' }])
    assertEquals(result, { errors: true, failedCount: 1 })
  } finally {
    restore()
  }
})

Deno.test('bulkIndex() is a no-op for an empty batch (no request sent)', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
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
      index: 'logs',
      autoInitialize: false,
    })
    await connector.search({ query: { match_all: {} } })

    assertStringIncludes(calls[0].url, 'logs/_search')
    assertEquals(JSON.parse(calls[0].init.body as string), { query: { match_all: {} } })
  } finally {
    restore()
  }
})

Deno.test('search() accepts a per-call index overriding the connector-level default', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ hits: { total: { value: 0 } } }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: 'default-index',
      autoInitialize: false,
    })
    await connector.search({ query: { match_all: {} } }, { index: 'other-index' })

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
      index: (doc) => `logs-${doc.level}`,
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
      index: 'logs',
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
      index: 'default-index',
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
      index: (doc) => `logs-${doc.level}`,
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
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
    assertEquals(await connector.checkClusterHealth(), true)
    assertStringIncludes(calls[0].url, '_cluster/health')
  } finally {
    restore()
  }
})

Deno.test('checkClusterHealth() returns false when the request fails', async () => {
  const { restore } = mockFetch(() => new Response('down', { status: 503 }))
  try {
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
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
    assertEquals((calls[0].init.headers as any).Authorization, 'ApiKey option-key')
  } finally {
    restore()
    Deno.env.delete('ELASTICSEARCH_API_KEY')
  }
})

Deno.test('falls back to the API key env vars, in order, when auth is omitted', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    Deno.env.set('OPENSEARCH_API_KEY', 'from-opensearch-key')
    const connectorFromOpenSearch = new ZanixElasticsearchConnector({ autoInitialize: false })
    await connectorFromOpenSearch.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, 'ApiKey from-opensearch-key')

    Deno.env.set('ELASTICSEARCH_API_KEY', 'from-elasticsearch-key')
    const connectorFromElasticsearch = new ZanixElasticsearchConnector({ autoInitialize: false })
    await connectorFromElasticsearch.index({ a: 1 })
    assertEquals((calls[1].init.headers as any).Authorization, 'ApiKey from-elasticsearch-key')
  } finally {
    restore()
    Deno.env.delete('ELASTICSEARCH_API_KEY')
    Deno.env.delete('OPENSEARCH_API_KEY')
  }
})

Deno.test('sends no Authorization header when auth and its env vars are unset', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
    await connector.index({ a: 1 })
    assertEquals((calls[0].init.headers as any).Authorization, undefined)
  } finally {
    restore()
  }
})

Deno.test('basic-auth credentials embedded in the node URL reach the server', async () => {
  // A mocked `fetch` (see `mockFetch` above) never reproduces the URL-userinfo-to-`Authorization`
  // behavior real `fetch` implementations provide — only a genuine `fetch` call proves it, so this
  // spins up an ephemeral local server instead of mocking anything.
  let seenAuth: string | null | undefined = 'NOT_CALLED'
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    seenAuth = req.headers.get('authorization')
    return new Response(JSON.stringify({}), {
      headers: { 'Content-Type': 'application/json' },
    })
  })

  try {
    const connector = new ZanixElasticsearchConnector({
      node: `http://myuser:mypass@localhost:${server.addr.port}`,
      autoInitialize: false,
    })
    await connector.index({ a: 1 })
    assertEquals(seenAuth, `Basic ${btoa('myuser:mypass')}`)
  } finally {
    await server.shutdown()
  }
})

Deno.test('a per-call index option overrides the connector-level default index', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ errors: false, items: [] }))
  try {
    const connector = new ZanixElasticsearchConnector({
      node: 'http://localhost:9200',
      index: 'default-index',
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

Deno.test('index accepts a per-document resolver function', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({}))
  try {
    const connector = new ZanixElasticsearchConnector({
      autoInitialize: false,
      index: (doc) => `logs-${doc.level}`,
    })
    await connector.index({ level: 'error' })
    assertStringIncludes(calls[0].url, 'logs-error/_doc')
  } finally {
    restore()
  }
})
