import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { ZanixRedisConnector } from 'modules/cache/providers/redis/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}
console.warn = () => {}

Deno.test('RedisCache basic operations', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.isReady

  // Clear database before testing
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

  // Test size
  await cache.set('x', 1)
  await cache.set('y', 2)
  assertEquals(await cache.size(), 2)

  // Test keys
  const keys = await cache.keys()
  assertEquals(keys.sort(), ['x', 'y'])

  // Test values
  const values = await cache.values()
  assertEquals(values.sort(), [1, 2])

  // Test clear
  await cache.clear()
  assertEquals(await cache.size(), 0)

  cache['close']()
})

Deno.test('RedisCache TTL expiration', async () => {
  const cache = new ZanixRedisConnector<string, string>({ ttl: 0.1, maxTTLOffset: 0 }) // TTL 100ms
  await cache.isReady

  await cache.clear()

  await cache.set('temp', 'hello')
  assertEquals(await cache.get('temp'), 'hello')

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 150))
  assertEquals(await cache.get('temp'), undefined)

  cache['close']()
})

Deno.test('RedisCache handles non-existent keys', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.isReady

  await cache.clear()

  const val = await cache.get('missing')
  assertEquals(val, undefined)
  assertEquals(await cache.has('missing'), false)
  assertEquals(await cache.delete('missing'), false)

  cache['close']()
})

Deno.test('execWithRetry fails after maxRetries', async () => {
  const cache = new ZanixRedisConnector<string, number>()
  await cache.isReady

  let attempts = 0

  cache['connected'] = false
  // Simulate failure
  const failingFn = () => {
    attempts++
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Simulated failure')), 100))
  }

  await assertRejects(
    async () => {
      // @ts-ignore use private execWithRetry
      await cache.execWithRetry(failingFn, 0)
    },
    Error,
    'Simulated failure',
  )

  // Should be intented 3 times at least
  if (attempts !== cache['maxCommandRetries']) {
    throw new Error(`Expected ${cache['maxCommandRetries']} attempts, got ${attempts}`)
  }

  cache['connected'] = true
  cache['close']()
})

Deno.test('RedisCache failed commands by connection timeout', async () => {
  const cache = new ZanixRedisConnector<string, number>({
    connectionTimeout: 1000,
    redisUrl: 'redis://localhost:6390', // closed port
  })

  const error = await assertRejects(
    () => cache.get('key'),
    InternalError,
  )

  assertEquals(error.code, 'REDIS_CONNECTION_TIMEOUT')

  cache['close']()
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'RedisCache scheduler shoud work on backround set with maxDelay',
  fn: async () => {
    const cache = new ZanixRedisConnector<string, number>({
      commandTimeout: 1000,
      maxCommandRetries: 1,
    })
    await cache.clear()

    const key = 'schedule-key'

    await cache.set(key, 1, { exp: 0.4, schedule: true })

    const value = await cache.get(key)
    assertFalse(value) // shoud not exist

    // wait 100ms to wait to save on background
    await new Promise((resolve) => setTimeout(resolve, 100))

    const savedValue = await cache.get(key)
    assert(savedValue)

    await cache.clear()
    cache['close']()
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'RedisCache scheduler shoud work on backround set with maxBatch',
  fn: async () => {
    const cache = new ZanixRedisConnector<string, number>({
      commandTimeout: 1000,
      maxCommandRetries: 1,
      schedulerOptions: {
        maxDelay: 1000,
        maxBatch: 2,
      },
    })
    await cache.clear()

    const key = 'schedule-key'

    await cache.set(key, 1, { exp: 0.4, schedule: true })

    const value = await cache.get(key)
    assertFalse(value) // shoud not exist

    await cache.set('schedule-key-2', 1, { exp: 0.4, schedule: true })

    const savedValue = await cache.get(key)
    assert(savedValue)

    await cache.clear()
    cache['close']()
  },
})

Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'RedisCache failed commands by command timeout',
  fn: async () => {
    const cache = new ZanixRedisConnector<string, number>({
      commandTimeout: 1000,
      maxCommandRetries: 1,
      redisUrl: 'redis://localhost:6390', // closed port
    })

    const error = await assertRejects(
      () => cache.get('key'),
      InternalError,
    )
    assertEquals(error.code, 'REDIS_COMMAND_TIMEOUT')

    cache['close']()
  },
})

// Keep this at the end to ensure the Redis connection (socket) closes properly.
Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'RedisCache closes properly',
  fn: async () => {
  },
})
