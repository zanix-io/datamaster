import { type CoreCacheConnectors, ZanixCacheProvider } from '@zanix/server'
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
   * @param {() => Promise<V>} [options.fetchFn] - A fallback fetch function if the cache miss occurs.
   * @param {number | 'KEEPTTL'} [options.exp] - Expiration in seconds, or `'KEEPTTL'` to preserve existing TTL.
   * @returns {Promise<V | undefined>} The cached or freshly fetched value, or `undefined` if not found.
   */
  public override async getCachedOrFetch<V, K>(
    provider: Extract<CoreCacheConnectors, 'redis'>,
    key: K,
    options: { fetchFn?: () => Promise<V>; exp?: number | 'KEEPTTL' } = {},
  ): Promise<V | undefined> {
    const local = this.local.get(key)
    if (local) return local

    const { exp, fetchFn } = options
    const cache = this[provider]

    const cached = await cache.get(key).then((result) => {
      this.local.set(key, result, exp)
      return result
    }).catch((err) => {
      if (!fetchFn) throw err
      logger.error('Cache save operation failed.', err, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'getCachedOrFetch', source: 'zanix' },
      })
    })
    if (cached) return cached

    if (!fetchFn) return

    const freshValue = await fetchFn()
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
   * @param {() => Promise<V>} [options.fetchFn] - A fallback fetch function to refresh the cache.
   * @param {number | 'KEEPTTL'} [options.exp] - Expiration in seconds, or `'KEEPTTL'` to keep the current TTL.
   * @param {number} [options.softTtl=45] - Soft TTL in seconds. After this time, the cache is refreshed in background.
   * @returns {Promise<V | undefined>} The cached or freshly fetched value, or `undefined` if not found.
   */
  public override async getCachedOrRevalidate<V, K>(
    provider: Extract<CoreCacheConnectors, 'redis'>,
    key: K,
    options: { fetchFn?: () => Promise<V>; exp?: number | 'KEEPTTL'; softTtl?: number } = {},
  ): Promise<V | undefined> {
    const getAge = (timestamp: number) => (Date.now() - timestamp) / 1000
    const { exp, softTtl = 45, fetchFn } = options
    const local = this.local.get(key)

    if (local && getAge(local.timestamp) < softTtl) return local.value

    const cache = this[provider]

    try {
      const cached = await cache.get(key)

      if (cached) {
        if (getAge(cached.timestamp) < softTtl) {
          this.local.set(key, cached, exp)
          return cached.value
        }

        // Refresh asynchronously if data is stale but not expired
        if (fetchFn) {
          queueMicrotask(async () => {
            try {
              const newValue = await fetchFn()
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
      if (!fetchFn) throw err
      logger.error('Cache save operation failed.', err, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'getCachedOrRevalidate', source: 'zanix' },
      })
    }

    if (!fetchFn) return

    // Get from the source
    const freshValue = await fetchFn()

    const entry = { value: freshValue, timestamp: Date.now() }
    await this.saveToCaches({ provider, key, value: entry, exp })
    return freshValue
  }

  /**
   * Saves a value into both the local cache and the specified external provider.
   */
  private async saveToCaches<K, V>(
    options: {
      provider: Extract<CoreCacheConnectors, 'redis'>
      key: K
      value: V
      exp?: number | 'KEEPTTL'
    },
  ) {
    const { key, exp, value, provider } = options
    this.local.set(key, value, exp)

    await this[provider].set(key, value, exp).catch((e) =>
      logger.error('Cache save operation failed.', e, {
        code: 'CACHE_SAVE_FAILED',
        meta: { key, method: 'saveToCaches', source: 'zanix' },
      })
    )
  }
}
