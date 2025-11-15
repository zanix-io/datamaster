import { assertEquals } from '@std/assert/assert-equals'
import { assertRejects, assertThrows } from '@std/assert'
import { ZanixCacheCoreProvider } from 'modules/cache/providers/mod.ts'
import { ZanixQLRUConnector } from 'modules/cache/providers/qlru/connector.ts'
import { Connector } from '@zanix/server'
import { ZanixRedisConnector } from 'modules/cache/providers/redis/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}
console.warn = () => {}

const registerInstance = () => {
  // Register instance
  @Connector('cache:local')
  class _Local extends ZanixQLRUConnector<string, string> {}

  // Register instance
  @Connector({ type: 'cache:redis', autoInitialize: false })
  class _Redis extends ZanixRedisConnector<string, string> {}
}

Deno.test('provider should throws on non instantiated cache', () => {
  const provider = new ZanixCacheCoreProvider('')

  assertThrows(() => provider.local, Error, 'An error occurred in the system')
})

// Test case for getCachedOrFetch: Should return cached value from local cache if it exists
Deno.test('getCachedOrFetch should return cached value from local cache', async () => {
  registerInstance()

  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'test-key'
  const value = 'cached-value'

  // Simulate the value being in the local cache
  provider.local.set(key, value, 60)

  // Call fbGet to retrieve the value from the cache
  const result = await provider.getCachedOrFetch('redis', key)
  assertEquals(result, value, 'Should return the cached value from the local cache')

  provider.redis['close']()
})

// Test case for getCachedOrFetch: Should fetch data and store it if cache miss occurs
Deno.test('getCachedOrFetch should fetch and store data when cache miss occurs', async () => {
  registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'new-key'
  const value = 'fetched-value'
  const fetcher = () => value // A simple fetch function

  // Call fbGet, which should invoke the fetchFn since the cache is missed
  const result = await provider.getCachedOrFetch('redis', key, { fetcher })
  assertEquals(result, value, 'Should return the fetched value from the fetch function')
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
  registerInstance()
  const provider = new ZanixCacheCoreProvider()
  await provider.redis['initialize']()

  const key = 'soft-ttl-key'
  const value = { value: 'soft-ttl-value', timestamp: Date.now() - 1000 } // 1 second old
  provider.local.set(key, value)

  const softTtl = 5 // Soft TTL is set to 5 seconds

  // Call softTtlGet and check if the value is returned from the cache within the soft TTL window
  const result = await provider.getCachedOrRevalidate('redis', key, { softTtl })
  assertEquals(result, value.value, 'Should return the cached value within soft TTL')

  provider.redis['close']()
})

// Test case for getCachedOrRevalidate: Should refresh data in background after soft TTL expires
Deno.test(
  'getCachedOrRevalidate should refresh data in background after soft TTL expires',
  async () => {
    registerInstance()
    const provider = new ZanixCacheCoreProvider('testContext')
    await provider.redis['initialize']()

    const key = 'refresh-key'
    const value = { value: 'old-value', timestamp: Date.now() - 10000 } // 10 seconds old
    provider.local.set(key, value)
    await provider.redis.set(key, value)

    const softTtl = 5 // Soft TTL is 5 seconds
    const fetcher = () => 'new-fresh-value' // A function to fetch new data

    // Wait a bit to ensure soft TTL has expired
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Call softTtlGet to check if the data is refreshed in the background
    const result = await provider.getCachedOrRevalidate('redis', key, { softTtl, fetcher })

    // Wait a bit to ensure fetchFn is completed on backround
    await new Promise((resolve) => setTimeout(resolve, 500))

    assertEquals(result, 'old-value', 'Should return the old value after soft TTL expiry')

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

    assertEquals(await provider.getCachedOrRevalidate('redis', key, { softTtl }), 'new-fresh-value')

    provider.redis['close']()
  },
)

// Test case for getCachedOrRevalidate: Should fallback to fetch if no cache available
Deno.test('getCachedOrRevalidate should fallback to fetch if no cache available', async () => {
  registerInstance()
  const provider = new ZanixCacheCoreProvider('testContext')
  await provider.redis['initialize']()

  const key = 'missing-key'
  const fetcher = () => Promise.resolve('fresh-data') // A function to fetch new data

  // Simulate cache miss (the value doesn't exist in either cache)
  const result = await provider.getCachedOrRevalidate('redis', key, { fetcher })

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
  registerInstance()
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
