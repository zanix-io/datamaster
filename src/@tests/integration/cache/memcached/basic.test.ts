import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import { ZanixMemcachedConnector } from 'modules/cache/providers/memcached/connector/mod.ts'

// mocks

console.info = () => {}
console.error = () => {}
console.warn = () => {}

Deno.test('MemcachedCache: basic set and get', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.set('c', 3)

  assertStrictEquals(await cache.get('a'), 1)
  assertStrictEquals(await cache.get('b'), 2)
  assertStrictEquals(await cache.get('c'), 3)

  cache['close']()
})

Deno.test('MemcachedCache: respects TTL expiration', async () => {
  // ttl:1 gave the immediate "still valid" read zero real margin against the actual 1s expiry —
  // under full-suite load, scheduler/IO contention from neighboring tests (real Mongo/Redis
  // activity elsewhere in the same run) can delay that read enough for the key to have genuinely
  // expired already (observed directly: `set` then an un-waited `get` came back `undefined`).
  // Same class of flake already fixed for `overwriting key resets TTL` below — widened the same
  // way instead of tightening the assertion.
  const cache = new ZanixMemcachedConnector<string, number>({
    ttl: 3,
    maxTTLOffset: 0,
  })
  await cache.isReady
  await cache.clear()

  await cache.set('x', 42)
  assertStrictEquals(await cache.get('x'), 42)

  // Wait well past the 3s TTL (Memcached's own TTL granularity is whole seconds)
  await new Promise((resolve) => setTimeout(resolve, 3500))
  assertEquals(await cache.get('x'), undefined)
  assertFalse(await cache.has('x'))

  cache['close']()
})

Deno.test('MemcachedCache: does not expire items when TTL is 0', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  await cache.set('a', 1)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assertStrictEquals(await cache.get('a'), 1)

  cache['close']()
})

Deno.test('MemcachedCache: clear() removes all items', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady

  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.clear()

  assertEquals(await cache.size(), 0)
  assertFalse(await cache.has('a'))

  cache['close']()
})

Deno.test('MemcachedCache: delete() removes specific item', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  await cache.set('a', 1)
  await cache.set('b', 2)
  const result = await cache.delete('a')

  assert(result)
  assertFalse(await cache.has('a'))
  assertEquals(await cache.size(), 1)

  cache['close']()
})

Deno.test('MemcachedCache: delete() on a missing key returns false', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  assertFalse(await cache.delete('missing'))

  cache['close']()
})

Deno.test('MemcachedCache: keys()/values() reflect only what this instance wrote', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady
  await cache.clear()

  await cache.set('a', 1)
  await cache.set('b', 2)

  assertEquals((await cache.keys()).sort(), ['a', 'b'])
  assertEquals((await cache.values()).sort(), [1, 2])
  assertEquals(await cache.size(), 2)

  cache['close']()
})

Deno.test('MemcachedCache: keys()/size() prune entries that expired server-side', async () => {
  const cache = new ZanixMemcachedConnector<string, number>({
    ttl: 1,
    maxTTLOffset: 0,
  })
  await cache.isReady
  await cache.clear()

  await cache.set('a', 1)
  await cache.set('b', 2)
  await new Promise((r) => setTimeout(r, 1300))

  assertEquals(await cache.keys(), [])
  assertEquals(await cache.size(), 0)

  cache['close']()
})

Deno.test(
  'MemcachedCache: keys()/values()/size() do NOT see a key written by another connector instance',
  async () => {
    const writer = new ZanixMemcachedConnector<string, number>()
    const reader = new ZanixMemcachedConnector<string, number>()
    await writer.isReady
    await reader.isReady
    await writer.clear()

    await writer.set('external-key', 99)

    // The real server-side value is reachable directly through get/has (those talk to the
    // server) — but keys()/values()/size() are blind to it because they're backed by `reader`'s
    // own local index, not the server. This is the documented tradeoff, not a bug.
    assertEquals(await reader.get('external-key'), 99)
    assertEquals(await reader.has('external-key'), true)
    assertEquals(await reader.keys(), [])
    assertEquals(await reader.size(), 0)

    writer['close']()
    reader['close']()
  },
)

Deno.test('MemcachedCache: overwriting key resets TTL', async () => {
  // Memcached's own TTL granularity is whole seconds (no sub-second precision like Redis's `PX`),
  // so the margins here are wider than the Redis/QLRU equivalent of this test to stay clear of
  // that 1-second clock resolution. `ttl: 3` (not `2`) and a 1500ms/1500ms split (not
  // 1200ms/1200ms) gives ~1.5s of slack on both sides of the reset instead of ~0.8s — the tighter
  // margin was observed to flake under full-suite load, where scheduler/IO contention from
  // neighboring tests' own `setTimeout` waits can push actual elapsed time past the nominal delay.
  const cache = new ZanixMemcachedConnector<string, number>({
    ttl: 3,
    maxTTLOffset: 0,
  })
  await cache.isReady
  await cache.clear()

  await cache.set('x', 10)
  await new Promise((r) => setTimeout(r, 1500))
  await cache.set('x', 20) // Reset TTL — expires ~3s from now, not ~3s from the original write

  await new Promise((r) => setTimeout(r, 1500)) // ~3000ms since first write, ~1500ms since overwrite
  assertEquals(await cache.get('x'), 20) // Still valid — would be expired if TTL hadn't reset

  cache['close']()
})

Deno.test('MemcachedCache: set() throws on exp: KEEPTTL (protocol cannot honor it)', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady

  let threw = false
  try {
    await cache.set('x', 1, { exp: 'KEEPTTL' })
  } catch (e) {
    threw = true
    assertEquals((e as { code?: string }).code, 'MEMCACHED_KEEPTTL_UNSUPPORTED')
  }
  assert(threw)

  cache['close']()
})

Deno.test('MemcachedCache: set() rejects an invalid key', async () => {
  const cache = new ZanixMemcachedConnector<string, number>()
  await cache.isReady

  let threw = false
  try {
    await cache.set('bad key with spaces', 1)
  } catch (e) {
    threw = true
    assertEquals((e as { code?: string }).code, 'MEMCACHED_INVALID_KEY')
  }
  assert(threw)

  cache['close']()
})
