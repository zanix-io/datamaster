import { assertEquals } from '@std/assert'
import { ZanixElasticsearchConnector } from 'observability/connector.ts'

/**
 * Proves that basic-auth credentials embedded in the node URL (`http://user:pass@host`) actually
 * reach the server as a real `Authorization` header — a genuine local HTTP server + a real
 * `fetch` call, moved out of `unit/observability/connector.test.ts` because a mocked `fetch`
 * (used by every other test in that file) never reproduces the URL-userinfo-to-`Authorization`
 * behavior real `fetch` implementations provide. Only a real server + real network round-trip can
 * prove it, which puts this test in `integration/`, never `unit/`.
 */
Deno.test('basic-auth credentials embedded in the node URL reach the server', async () => {
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
