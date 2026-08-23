import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { ZanixMemcachedConnector } from 'modules/cache/providers/memcached/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}
console.warn = () => {}

Deno.test('MemcachedCache basic operations', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  // Test set and get
  await cache.set('a', 123)
  const val = await cache.get('a')
  assertEquals(val, 123)

  // Test has
  assert(await cache.has('a') === true)
  assert(await cache.has('b') === false)

  // Test delete
  const deleted = await cache.delete('a')
  assertEquals(deleted, true)
  assertEquals(await cache.get('a'), undefined)

  // Test size/keys/values
  await cache.set('x', 1)
  await cache.set('y', 2)
  assertEquals(await cache.size(), 2)
  assertEquals((await cache.keys()).sort(), ['x', 'y'])
  assertEquals((await cache.values()).sort(), [1, 2])

  // Test clear
  await cache.clear()
  assertEquals(await cache.size(), 0)

  cache['close']()
})

Deno.test('MemcachedCache handles non-existent keys', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  const val = await cache.get('missing')
  assertEquals(val, undefined)
  assertEquals(await cache.has('missing'), false)
  assertEquals(await cache.delete('missing'), false)

  cache['close']()
})

Deno.test(
  'MemcachedCache close() is a safe no-op before the connection ever opens, and if called twice',
  async () => {
    // Before `isReady` resolves, `#client` is still undefined — `close()`'s own `this.#client?.close()`
    // must not throw.
    const neverConnected = new ZanixMemcachedConnector<string, number>()
    neverConnected['close']()
    // Let the still-in-flight `initialize()` settle before the test ends, rather than leaving a
    // dangling connect op behind (the early close() above doesn't cancel it).
    await neverConnected.isReady
    neverConnected['close']()

    // Once connected, closing twice must also be a safe no-op — the second call hits
    // `MemcachedSocket.close()`'s own `this.#conn?.close()` guard against an already-cleared connection.
    const cache = new ZanixMemcachedConnector<string, number>()
    await cache.isReady
    cache['close']()
    cache['close']()
    assertFalse(cache.isHealthy())
  },
)

Deno.test('MemcachedCache getClient() returns the underlying protocol client', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady

  const client = cache.getClient<{ connected: boolean }>()
  assert(client.connected)

  cache['close']()
})

Deno.test('MemcachedCache isHealthy() reflects the live TCP connection', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()

  // Before `isReady` resolves, the underlying client hasn't been created yet — isHealthy() must
  // report false rather than throw (the `#client?.connected ?? false` fallback).
  assertFalse(cache.isHealthy())

  await cache.isReady

  assert(cache.isHealthy())
  cache['close']()
  assertFalse(cache.isHealthy())
})

Deno.test('MemcachedCache getClient().version() probes the live server', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady

  const version = await cache.getClient().version()
  assert(version.startsWith('VERSION '))

  cache['close']()
})

Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'MemcachedCache fails with a connection timeout against an unreachable host',
  fn: async () => {
    const cache = new ZanixMemcachedConnector<string, number>({
      connectionTimeout: 500,
      memcachedUri: 'localhost:11299', // closed port
    })

    const error = await assertRejects(
      () => cache.get('key'),
      InternalError,
    )
    assertEquals(error.code, 'MEMCACHED_CONNECTION_TIMEOUT')

    cache['close']()
  },
})

Deno.test('MemcachedCache transparently reconnects after the connection is closed', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  await cache.set('reconnect-key', 1)
  // Force-close the underlying socket without going through the connector's own lifecycle.
  cache.getClient().close()
  assertFalse(cache.isHealthy())

  // The next command transparently reopens the connection (one attempt, no retry loop — see the
  // client's own JSDoc) rather than failing outright.
  await cache.set('reconnect-key', 2)
  assertEquals(await cache.get('reconnect-key'), 2)
  assert(cache.isHealthy())

  cache['close']()
})

// Keep this at the end to ensure the Memcached connection (socket) closes properly.
Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'MemcachedCache closes properly',
  fn: async () => {
  },
})
