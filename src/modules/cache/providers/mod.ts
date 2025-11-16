import { type CoreCacheConnectors, ZanixCacheProvider } from '@zanix/server'
import { LockManager } from 'utils/queues/lock-manager.ts'
import logger from '@zanix/logger'

/**
 * Core cache provider with multi-level caching (local + external).
 *
 * Provides fallback caching strategies to reduce Redis load, including
 * local in-memory caching, soft TTL expiration, and asynchronous background refresh.
 *
 * @extends ZanixCacheProvider
 */
export class ZanixCacheCoreProvider extends ZanixCacheProvider {
  private keyLockManager = new LockManager() // Exclusive lock per key, only one function runs at a time by default

  /**
   * Retrieves a value from cache with local fallback and optional fetch.
   *
   * This method first attempts to read from the local cache. If not found,
   * it queries the specified remote cache provider (e.g. Redis, memcached, etc.).
   *
   * If the key is not found in either cache and a `fetchFn` is provided,
   * the value will be fetched, stored in all caches, and then returned.
   *
   * @template V The value type.
   * @template K The key type.
   * @param {Exclude<CoreCacheConnectors, 'local'>} provider - The external cache provider to query.
   * @param {K} key - The cache key to look up.
   * @param {Object} [options] - Additional configuration.
   * @param {() => Promise<V>} [options.fetcher] - A fallback fetch function if the cache miss occurs.
   * @param {number | 'KEEPTTL'} [options.exp] - Expiration in seconds, or `'KEEPTTL'` to preserve existing TTL.
   * @returns {Promise<V | undefined>} The cached or freshly fetched value, or `undefined` if not found.
   */
  public override async getCachedOrFetch<V, K = string>(
    provider: Extract<CoreCacheConnectors, 'redis'>,
    key: K,
    options: { fetcher?: () => V | Promise<V>; exp?: number | 'KEEPTTL' } = {},
  ): Promise<V> {
    const local = this.local.get(key)
    if (local !== undefined) return local

    const { exp, fetcher } = options
    const cache = this[provider]

    const cached = await cache.get(key).then((result) => {
      this.local.set(key, result, exp)
      return result
    }).catch((err) => {
      if (!fetcher) throw err
      logger.error('Cache save operation failed.', err, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'getCachedOrFetch', source: 'zanix' },
      })
    })
    if (cached !== undefined) return cached

    if (!fetcher) return undefined as V

    const freshValue = await fetcher()
    await this.saveToCaches({ provider, key, value: freshValue, exp })
    return freshValue
  }

  /**
   * Retrieves a cached value using a soft TTL strategy and local fallback.
   *
   * Implements a dual-phase expiration mechanism:
   * - During the soft TTL window, values are served directly as “fresh”.
   * - After soft TTL (but before hard TTL expiration), the cached value
   *   is returned immediately while it is refreshed asynchronously in the background.
   *
   * Falls back to the local cache if the external provider (e.g. Redis) is unavailable.
   * If no cached value is found and a `fetchFn` is provided, it will fetch, cache,
   * and return the new value.
   *
   * @template V The value type.
   * @template K The key type.
   * @param {Exclude<CoreCacheConnectors, 'local'>} provider - The external cache provider (e.g. Redis).
   * @param {K} key - The cache key to retrieve.
   * @param {Object} [options] - Additional configuration.
   * @param {() => Promise<V>} [options.fetcher] - A fallback fetch function to refresh the cache.
   * @param {number | 'KEEPTTL'} [options.exp] - Expiration in seconds, or `'KEEPTTL'` to keep the current TTL.
   * @param {number} [options.softTtl=45] - Soft TTL in seconds. After this time, the cache is refreshed in background.
   * @returns {Promise<V | undefined>} The cached or freshly fetched value, or `undefined` if not found.
   */
  public override async getCachedOrRevalidate<V, K = string>(
    provider: Extract<CoreCacheConnectors, 'redis'>,
    key: K,
    options: { fetcher?: () => V | Promise<V>; exp?: number | 'KEEPTTL'; softTtl?: number } = {},
  ): Promise<V> {
    const getAge = (timestamp: number) => (Date.now() - timestamp) / 1000
    const { exp, softTtl = 45, fetcher } = options
    const local = this.local.get(key)

    if (local !== undefined && getAge(local.timestamp) < softTtl) return local.value

    const cache = this[provider]

    try {
      const cached = await cache.get(key)
      if (cached !== undefined) {
        if (getAge(cached.timestamp) < softTtl) {
          this.local.set(key, cached, exp)
          return cached.value
        }

        // Refresh asynchronously if data is stale but not expired
        if (fetcher) {
          queueMicrotask(async () => {
            try {
              const newValue = await fetcher()
              await this.saveToCaches({
                provider,
                key,
                value: { value: newValue, timestamp: Date.now() },
                exp,
              })
            } catch (e) {
              logger.error('Cache refresh operation failed.', e, {
                code: 'CACHE_REFRESH_FAILED',
                meta: { key, method: 'getCachedOrRevalidate:queueMicrotask', source: 'zanix' },
              })
            }
          })
        }

        this.local.set(key, cached, exp)
        return cached.value
      }
    } catch (err) {
      if (!fetcher) throw err
      logger.error('Cache save operation failed.', err, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'getCachedOrRevalidate', source: 'zanix' },
      })
    }

    if (!fetcher) return undefined as V

    // Get from the source
    const freshValue = await fetcher()

    const entry = { value: freshValue, timestamp: Date.now() }
    await this.saveToCaches({ provider, key, value: entry, exp })
    return freshValue
  }

  /**
   * Saves a value into both the local cache and the specified external cache provider.
   *
   * This method stores `value` under `key` in the local (in-memory) cache and also
   * writes it to the external provider indicated by `provider` (e.g. Redis).
   *
   * @template K - Type of the cache key.
   * @template V - Type of the cached value.
   *
   * @param {Object} options - Options controlling how the value is saved.
   * @param {Extract<CoreCacheConnectors, 'redis'>} options.provider - External cache provider/connector to use (currently `'redis'`).
   * @param {K} options.key - The key under which the value will be stored.
   * @param {V} options.value - The value to store in caches.
   * @param {number | 'KEEPTTL'} [options.exp] - TTL in seconds for the external cache, or `'KEEPTTL'` to preserve the existing TTL.
   * @param {boolean} [options.schedule=false] - If `true`, schedule the external write (e.g. enqueue or perform in background) instead of performing it synchronously (use for redis).
   *
   * @returns {Promise<void>} Resolves when the local cache is updated and the external write has been scheduled or completed.
   *
   * @throws {Error} If the operation fails (e.g. local cache update fails or external write scheduling fails).
   */
  public override async saveToCaches<K, V>(
    options: {
      provider: Extract<CoreCacheConnectors, 'redis'>
      key: K
      value: V
      exp?: number | 'KEEPTTL'
      schedule?: boolean
    },
  ): Promise<void> {
    const { key, exp, value, provider, schedule } = options
    const args = [key, value, exp, schedule] as const

    this.local.set(...args)

    await this[provider].set(...args).catch((e) =>
      logger.error('Cache save operation failed.', e, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'saveToCaches', source: 'zanix' },
      })
    )
  }

  /**
   * Executes the provided asynchronous function under an exclusive lock associated with the given key.
   *
   * This method ensures that only one operation at a time can run for the specified key.
   * Multiple calls using different keys may execute in parallel, but calls sharing the same key will
   * be queued and executed sequentially.
   *
   * Internally, this uses a {@link LockManager} configured with 1 permit, meaning each key provides
   * an exclusive lock (mutex-style behavior).
   *
   * **Use case:**
   * - Use when you need to synchronize access to a resource across multiple operations
   *   (e.g., preventing race conditions in shared resources).
   *
   * **Do not use if:**
   * - You are working in a distributed system or need a distributed lock (e.g., microservices).
   * - High-frequency or low-latency operations where locking overhead is not acceptable.
   *
   * This is an in-memory lock. In distributed environments, you can leverage Redis
   * to implement a proper distributed locking mechanism.
   *
   * @template T
   * @param {string} key - The unique identifier used to determine which operations
   *                       should be mutually exclusive.
   * @param {() => Promise<T>} fn - The asynchronous function to execute once the lock
   *                                for the given key is acquired.
   * @returns {Promise<T>} A promise that resolves with the result of the executed function.
   */
  public override withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.keyLockManager.withLock<T>(key, fn)
  }
}
