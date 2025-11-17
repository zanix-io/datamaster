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
  const cache = new ZanixRedisConnector<string, number>({ ttl: 0.1, maxTTLOffset: 0 }) // 100 ms TTL
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
  const cache = new ZanixRedisConnector<string, number>({ ttl: 0.1, maxTTLOffset: 0 })
  await cache.set('a', 1)
  await cache.set('b', 2)
  await cache.set('c', 3)
  await new Promise((r) => setTimeout(r, 150))

  assertEquals(await cache.size(), 0)

  cache['close']()
})

Deno.test('RedisCache: keys() returns valid non-expired keys', async () => {
  const cache = new ZanixRedisConnector<string, number>({ ttl: 0.1, maxTTLOffset: 0 })
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
  const cache = new ZanixRedisConnector<string, number>({ ttl: 0.1, maxTTLOffset: 0 })
  await cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 80))
  await cache.set('x', 20) // Reset TTL

  await new Promise((r) => setTimeout(r, 80)) // Now 160ms since first write, but <100ms since overwrite

  assertEquals(await cache.get('x'), 20) // Still valid

  cache['close']()
})

Deno.test('RedisCache: overwriting key dont resets TTL if KEEP', async () => {
  const cache = new ZanixRedisConnector<string, number>({ ttl: 1, maxTTLOffset: 0 })
  await cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 800))
  await cache.set('x', 20, { exp: 'KEEPTTL' }) // KEEP TTL

  await new Promise((r) => setTimeout(r, 100)) // Now 900ms since first write

  assertEquals(await cache.get('x'), 20) // Still valid

  await new Promise((r) => setTimeout(r, 200)) // Now 1100ms since first write

  assertFalse(await cache.has('x'))

  cache['close']()
})

Deno.test('RedisCache: with custom TTL', async () => {
  const cache = new ZanixRedisConnector<string, number>({ ttl: 1 })
  await cache.set('x', 10, { maxTTLOffset: 0 })

  await new Promise((r) => setTimeout(r, 800))
  await cache.set('x', 20, { exp: 0.7, maxTTLOffset: 0 }) // Reset TTL with custom TTL value

  await new Promise((r) => setTimeout(r, 600)) // Now 1600ms since first write

  assert(await cache.has('x'))

  await new Promise((r) => setTimeout(r, 800)) // Now 1600ms since first write

  assertFalse(await cache.has('x'))

  cache['close']()
})
