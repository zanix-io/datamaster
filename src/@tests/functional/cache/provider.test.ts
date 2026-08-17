// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert/assert-equals'
import { assertRejects, assertThrows } from '@std/assert'
import { ZanixCacheCoreProvider } from 'modules/cache/providers/mod.ts'
import { ZanixRedisConnector } from 'modules/cache/providers/redis/connector/mod.ts'
import { Connector, registerCoreConnectorSlot, ZanixCacheConnector } from '@zanix/server'
import logger from '@zanix/logger'

// mocks
console.info = () => {}
console.error = () => {}
console.warn = () => {}

// This test decorates `_Redis` directly rather than importing `cache/providers/redis/core.ts`, so
// the `'cache:redis'` slot needs registering explicitly here — `@zanix/datamaster` owns it
// (see `redis/core.ts`'s own registration), but that file is never reached by this test's own
// import graph.
registerCoreConnectorSlot('cache:redis', ZanixCacheConnector)

const registerInstance = async () => {
  // Register instance
  await import('../../../modules/cache/providers/qlru/core.ts')

  // Register instance
  @Connector({ slot: 'cache:redis', autoInitialize: false })
  class _Redis extends ZanixRedisConnector<string, string> {}
}

Deno.test('provider should throws on non instantiated cache', () => {
  const provider = new ZanixCacheCoreProvider('')

  assertThrows(() => provider.local, Error, 'An error occurred in the system')
})

// Test case for getCachedOrFetch: Should return cached value from local cache if it exists
Deno.test('getCachedOrFetch should return cached value from local cache', async () => {
  await registerInstance()

  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'test-key'
  const value = 'cached-value'

  // Simulate the value being in the local cache
  provider.local.set(key, value, { exp: 60 })

  // Call fbGet to retrieve the value from the cache
  const result = await provider.getCachedOrFetch('redis', key)
  assertEquals(
    result,
    value,
    'Should return the cached value from the local cache',
  )

  provider.redis['close']()
})

// Test case for getCachedOrFetch: Should fetch data and store it if cache miss occurs
Deno.test('getCachedOrFetch should fetch and store data when cache miss occurs', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'new-key'
  const value = 'fetched-value'
  const fetcher = () => value // A simple fetch function

  // Call fbGet, which should invoke the fetchFn since the cache is missed
  const result = await provider.getCachedOrFetch('redis', key, { fetcher })
  assertEquals(
    result,
    value,
    'Should return the fetched value from the fetch function',
  )
  assertEquals(
    provider.local.has(key),
    true,
    'Should store the fetched value in the local cache',
  )
  assertEquals(
    await provider.redis.has(key),
    true,
    'Should store the fetched value in the external cache',
  )

  provider.redis['close']()
})

// Test case for getCachedOrRevalidate: Should return cached value within soft TTL window
Deno.test('getCachedOrRevalidate should return cached value within soft TTL window', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider()
  await provider.redis['initialize']()

  const key = 'soft-ttl-key'
  const value = { value: 'soft-ttl-value', timestamp: Date.now() - 1000 } // 1 second old
  provider.local.set(key, value, {})

  const softTtl = 5 // Soft TTL is set to 5 seconds

  // Call softTtlGet and check if the value is returned from the cache within the soft TTL window
  const result = await provider.getCachedOrRevalidate('redis', key, {
    softTtl,
  })
  assertEquals(
    result,
    value.value,
    'Should return the cached value within soft TTL',
  )

  provider.redis['close']()
})

// Test case for getCachedOrRevalidate: Should refresh data in background after soft TTL expires
Deno.test(
  'getCachedOrRevalidate should refresh data in background after soft TTL expires',
  async () => {
    await registerInstance()
    const provider = new ZanixCacheCoreProvider('testContext')
    await provider.redis['initialize']()

    const key = 'refresh-key'
    const value = { value: 'old-value', timestamp: Date.now() - 10000 } // 10 seconds old
    provider.local.set(key, value, {})
    await provider.redis.set(key, value, {})

    const softTtl = 5 // Soft TTL is 5 seconds
    const fetcher = () => 'new-fresh-value' // A function to fetch new data

    // Wait a bit to ensure soft TTL has expired
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Call softTtlGet to check if the data is refreshed in the background
    const result = await provider.getCachedOrRevalidate('redis', key, {
      softTtl,
      fetcher,
    })

    // Wait a bit to ensure fetchFn is completed on backround
    await new Promise((resolve) => setTimeout(resolve, 500))

    assertEquals(
      result,
      'old-value',
      'Should return the old value after soft TTL expiry',
    )

    assertEquals(
      provider.local.get(key).value,
      'new-fresh-value',
      'Should update the local cache with the new value in the background',
    )
    assertEquals(
      (await provider.redis.get(key)).value,
      'new-fresh-value',
      'Should update the external cache with the new value in the background',
    )

    assertEquals(
      await provider.getCachedOrRevalidate('redis', key, { softTtl }),
      'new-fresh-value',
    )

    provider.redis['close']()
  },
)

// Test case for getCachedOrRevalidate: Should fallback to fetch if no cache available
Deno.test('getCachedOrRevalidate should fallback to fetch if no cache available', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'missing-key'
  const fetcher = () => Promise.resolve('fresh-data') // A function to fetch new data

  // Simulate cache miss (the value doesn't exist in either cache)
  const result = await provider.getCachedOrRevalidate('redis', key, {
    fetcher,
  })

  assertEquals(result, 'fresh-data', 'Should fetch data if not found in cache')
  assertEquals(
    provider.local.has(key),
    true,
    'Should store the fetched value in the local cache',
  )
  assertEquals(
    await provider.redis.has(key),
    true,
    'Should store the fetched value in the external cache',
  )

  provider.redis['close']()
})

// Test case for getCachedOrRevalidate: Should handle errors gracefully
Deno.test('getCachedOrRevalidate should handle errors gracefully', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'error-key'
  const fetcher = () => {
    throw new Error('Fetch failed')
  } // Simulate an error in the fetch function

  // Ensure the error is thrown if fetch fails
  await assertRejects(
    async () => {
      await provider.getCachedOrRevalidate('redis', key, { fetcher })
    },
    Error,
    'Fetch failed', // The error message we expect
  )

  provider.redis['close']()
})

Deno.test('QLRU cache should not reinitializate', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')

  provider.local.set('1', 1, { exp: 10 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assertEquals(provider.local.get('1'), 1)
})

Deno.test('getCachedOrFetch returns an external-cache hit directly, no fetcher', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'external-hit-no-fetcher-key'
  // Only the external cache has it — local is empty, so this exercises the "cached !== undefined"
  // early-return path (not the local-cache short-circuit at the top of the method).
  await provider.redis.set(key, 'from-redis', {})

  const result = await provider.getCachedOrFetch('redis', key)

  assertEquals(result, 'from-redis')

  provider.redis['close']()
})

Deno.test('getCachedOrFetch returns undefined with nothing cached and no fetcher', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const result = await provider.getCachedOrFetch(
    'redis',
    'totally-missing-key',
  )

  assertEquals(result, undefined)

  provider.redis['close']()
})

Deno.test('getCachedOrFetch rethrows when the cache read fails with no fetcher', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const redisProto = Object.getPrototypeOf(provider.redis)
  const originalGet = redisProto.get
  redisProto.get = () => Promise.reject(new Error('redis get failed'))

  try {
    await assertRejects(
      () => provider.getCachedOrFetch('redis', 'any-key'),
      Error,
      'redis get failed',
    )
  } finally {
    redisProto.get = originalGet
    provider.redis['close']()
  }
})

Deno.test('getCachedOrFetch falls through to the fetcher when the cache read fails', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const redisProto = Object.getPrototypeOf(provider.redis)
  const originalGet = redisProto.get
  redisProto.get = () => Promise.reject(new Error('redis get failed'))

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    const result = await provider.getCachedOrFetch('redis', 'fallback-key', {
      fetcher: () => 'fetched-despite-error',
    })

    assertEquals(result, 'fetched-despite-error')
    assertEquals(errors.length, 1)
    assertEquals((errors[0] as unknown[])[0], 'Cache save operation failed.')
  } finally {
    redisProto.get = originalGet
    logger.error = originalError
    provider.redis['close']()
  }
})

Deno.test('getCachedOrRevalidate returns an external-cache hit within soft TTL', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'revalidate-external-hit-key'
  const value = { value: 'fresh-from-redis', timestamp: Date.now() - 1000 }
  // Only the external cache has it — local is empty, so this exercises the redis-level "within
  // soft TTL" branch instead of the local-cache short-circuit at the top of the method.
  await provider.redis.set(key, value, {})

  const result = await provider.getCachedOrRevalidate('redis', key, {
    softTtl: 5,
  })

  assertEquals(result, 'fresh-from-redis')
  assertEquals(provider.local.get(key).value, 'fresh-from-redis')

  provider.redis['close']()
})

Deno.test('getCachedOrRevalidate returns undefined with no cache/fetcher', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const result = await provider.getCachedOrRevalidate(
    'redis',
    'totally-missing-revalidate-key',
  )

  assertEquals(result, undefined)

  provider.redis['close']()
})

Deno.test('getCachedOrRevalidate rethrows when the cache read fails with no fetcher', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const redisProto = Object.getPrototypeOf(provider.redis)
  const originalGet = redisProto.get
  redisProto.get = () => Promise.reject(new Error('redis get failed'))

  try {
    await assertRejects(
      () => provider.getCachedOrRevalidate('redis', 'any-key'),
      Error,
      'redis get failed',
    )
  } finally {
    redisProto.get = originalGet
    provider.redis['close']()
  }
})

Deno.test('getCachedOrRevalidate falls through to the fetcher when the read fails', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const redisProto = Object.getPrototypeOf(provider.redis)
  const originalGet = redisProto.get
  redisProto.get = () => Promise.reject(new Error('redis get failed'))

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    const result = await provider.getCachedOrRevalidate(
      'redis',
      'revalidate-fallback-key',
      {
        fetcher: () => 'fetched-despite-error',
      },
    )

    assertEquals(result, 'fetched-despite-error')
    assertEquals(errors.length, 1)
    assertEquals((errors[0] as unknown[])[0], 'Cache save operation failed.')
  } finally {
    redisProto.get = originalGet
    logger.error = originalError
    provider.redis['close']()
  }
})

Deno.test('getCachedOrRevalidate logs when a background refresh fetcher fails', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'revalidate-background-fail-key'
  const value = { value: 'stale-value', timestamp: Date.now() - 10000 } // 10s old
  await provider.redis.set(key, value, {})

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    // Stale-but-present triggers a background refresh (queueMicrotask) — this fetcher fails.
    const result = await provider.getCachedOrRevalidate('redis', key, {
      softTtl: 5,
      fetcher: () => {
        throw new Error('background refresh failed')
      },
    })

    // The stale value is still returned immediately; the failure surfaces only in the background.
    assertEquals(result, 'stale-value')

    await new Promise((resolve) => setTimeout(resolve, 100))
    assertEquals(errors.length, 1)
    assertEquals(
      (errors[0] as unknown[])[0],
      'Cache refresh operation failed.',
    )
  } finally {
    logger.error = originalError
    provider.redis['close']()
  }
})

Deno.test('saveToCaches logs and swallows an error from the external cache write', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const redisProto = Object.getPrototypeOf(provider.redis)
  const originalSet = redisProto.set
  redisProto.set = () => Promise.reject(new Error('redis set failed'))

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    const key = 'save-to-caches-fail-key'
    // Must not throw, even though the external write fails.
    await provider.saveToCaches({ provider: 'redis', key, value: 'v' })

    // The local cache still gets written before the (failing) external write is attempted.
    assertEquals(provider.local.get(key), 'v')
    assertEquals(errors.length, 1)
    assertEquals((errors[0] as unknown[])[0], 'Cache save operation failed.')
  } finally {
    redisProto.set = originalSet
    logger.error = originalError
    provider.redis['close']()
  }
})

Deno.test('withLock runs the function under an exclusive lock and returns its result', async () => {
  await registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')

  const result = await provider.withLock(
    'lock-key',
    () => Promise.resolve('locked-result'),
  )

  assertEquals(result, 'locked-result')
})
