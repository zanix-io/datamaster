import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import { ZanixRedisConnector } from 'modules/cache/providers/redis/connector/mod.ts'

// mocks

console.info = () => {}
console.error = () => {}
console.warn = () => {}

Deno.test('RedisCache: basic set and get', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.set('c', 3)

  assertStrictEquals(await cache.get('a'), 1)
  assertStrictEquals(await cache.get('b'), 2)
  assertStrictEquals(await cache.get('c'), 3)

  cache['close']()
})

Deno.test('RedisCache: respects TTL expiration', async () => {
  const cache = new ZanixRedisConnector<string, number>({
    ttl: 0.1,
    maxTTLOffset: 0,
  }) // 100 ms TTL
  await cache.set('x', 42)
  assertStrictEquals(await cache.get('x'), 42)

  // Wait until item expires
  await new Promise((resolve) => setTimeout(resolve, 150))
  assertEquals(await cache.get('x'), undefined)
  assertFalse(await cache.has('x'))

  cache['close']()
})

Deno.test('RedisCache: does not expire items when TTL is 0', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.set('a', 1)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  assertStrictEquals(await cache.get('a'), 1)

  cache['close']()
})

Deno.test('RedisCache: scanKeys shoud work correctly', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.set('a', 1)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  assertStrictEquals(await cache.get('a'), 1)

  cache['close']()
})

Deno.test('RedisCache: lua support and clear with lua', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  const client = await cache.getClient()
  const result = await client.eval(
    `
    local key = KEYS[1]
    local value = ARGV[1]

    redis.call("SET", key, value)
    return redis.call("GET", key)
    `,
    { keys: ['demo:key'], arguments: ['hola'] },
  )

  assertEquals(result, 'hola')

  cache['close']()
})

Deno.test('RedisCache: clear() removes all items', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.clear()

  assertEquals(await cache.size(), 0)
  assertFalse(await cache.has('a'))

  cache['close']()
})

Deno.test('RedisCache: delete() removes specific item', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.set('a', 1)
  await cache.set('b', 2)
  const result = await cache.delete('a')

  assert(result)
  assertFalse(await cache.has('a'))
  assertEquals(await cache.size(), 1)

  cache['close']()
})

Deno.test('RedisCache: size() evicts expired items', async () => {
  const cache = new ZanixRedisConnector<string, number>({
    ttl: 0.1,
    maxTTLOffset: 0,
  })
  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.set('c', 3)
  await new Promise((r) => setTimeout(r, 150))

  assertEquals(await cache.size(), 0)

  cache['close']()
})

Deno.test('RedisCache: keys() returns valid non-expired keys', async () => {
  const cache = new ZanixRedisConnector<string, number>({
    ttl: 0.1,
    maxTTLOffset: 0,
  })
  await cache.set('b', 2)
  await cache.set('a', 1)

  const keysBefore = await cache.keys()
  assertEquals(keysBefore.sort(), ['a', 'b'])

  await new Promise((r) => setTimeout(r, 150))
  assertEquals(await cache.keys(), [])

  cache['close']()
})

Deno.test('RedisCache: values() returns valid non-expired values', async () => {
  const cache = new ZanixRedisConnector<string, number>({ ttl: 0.1 })
  await cache.set('a', 1, { maxTTLOffset: 0 })
  await cache.set('b', 2, { maxTTLOffset: 0 })

  const valuesBefore = await cache.values()
  assertEquals(valuesBefore.sort(), [1, 2])

  await new Promise((r) => setTimeout(r, 150))
  assertEquals(await cache.values(), [])

  cache['close']()
})

Deno.test('RedisCache: overwriting key resets TTL', async () => {
  const cache = new ZanixRedisConnector<string, number>({
    ttl: 0.1,
    maxTTLOffset: 0,
  })
  await cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 80))
  await cache.set('x', 20) // Reset TTL

  await new Promise((r) => setTimeout(r, 80)) // Now 160ms since first write, but <100ms since overwrite

  assertEquals(await cache.get('x'), 20) // Still valid

  cache['close']()
})

Deno.test('RedisCache: overwriting key dont resets TTL if KEEP', async () => {
  // Wider margins than a naive 1s TTL with a ~100ms window around it — under full-suite load,
  // scheduler/IO contention from neighboring tests (real Mongo/Memcached activity elsewhere in
  // the same run) can push actual elapsed time past a tight nominal window, causing the "still
  // valid" read to land after the key has genuinely expired. Same class of flake already fixed
  // for the Memcached equivalent, `overwriting key resets TTL`, in this file's own memcached
  // sibling — widened here the same way instead of tightening the assertion.
  const cache = new ZanixRedisConnector<string, number>({
    ttl: 6,
    maxTTLOffset: 0,
  })
  await cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 2000))
  await cache.set('x', 20, { exp: 'KEEPTTL' }) // KEEP TTL

  await new Promise((r) => setTimeout(r, 2000)) // Now ~4000ms since first write — still within the 6s TTL

  assertEquals(await cache.get('x'), 20) // Still valid

  await new Promise((r) => setTimeout(r, 3000)) // Now ~7000ms since first write — safely past the 6s TTL

  assertFalse(await cache.has('x'))

  cache['close']()
})

Deno.test('RedisCache: with custom TTL', async () => {
  // The overwrite at 800ms sets a custom 0.7s TTL (expires at ~1500ms since first write) — the
  // original 600ms wait afterward (checking "still valid" at ~1400ms) left only ~100ms of real
  // margin, the same class of flake fixed for the other TTL tests in this file (also: the stale
  // comments below both said "Now 1600ms" for two different actual times). Widened the same way.
  const cache = new ZanixRedisConnector<string, number>({ ttl: 1 })
  await cache.set('x', 10, { maxTTLOffset: 0 })

  await new Promise((r) => setTimeout(r, 800))
  await cache.set('x', 20, { exp: 2, maxTTLOffset: 0 }) // Reset TTL with a custom 2s TTL value

  await new Promise((r) => setTimeout(r, 1000)) // Now ~1800ms since first write — still within the 2.8s expiry

  assert(await cache.has('x'))

  await new Promise((r) => setTimeout(r, 1500)) // Now ~3300ms since first write — safely past the 2.8s expiry

  assertFalse(await cache.has('x'))

  cache['close']()
})
