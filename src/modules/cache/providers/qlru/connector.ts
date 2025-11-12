import type { CacheEntry, QLRUCacheOptions } from 'cache/typings/general.ts'
import { ZanixCacheConnector } from '@zanix/server'
import { InternalError } from '@zanix/errors'

/**
 * A fast and lightweight Least Recently Used (LRU) cache with optional TTL (Time-To-Live) support.
 *
 * The cache automatically removes the least recently used or expired entries when capacity is reached.
 *
 * Environment Variables:
 * - **LOCAL_CACHE_MAX_ITEMS**: Optional. Defines the maximum number of items
 *   that can be stored in the local in-memory cache before older entries are evicted.
 *   This helps control memory usage for cached query results or metadata.
 *   Example: `LOCAL_CACHE_MAX_ITEMS=500`
 *   Defaults to `50000`.
 *
 * @template K Type of keys.
 * @template V Type of values.
 */
// deno-lint-ignore no-explicit-any
export class ZanixQLRUConnector<K = string, V = any> extends ZanixCacheConnector<K, V, 'sync'> {
  #cache!: Map<K, CacheEntry<V>>
  protected readonly capacity: number
  private randomOffset

  /**
   * Creates an instance of QuickLRU.
   * @param capacity The maximum number of items the cache can hold. Defaults `50000`
   * @param ttl Optional TTL (in seconds). If set, each entry expires after this duration.
   */
  constructor(options: QLRUCacheOptions) {
    const {
      capacity = Number(Deno.env.get('LOCAL_CACHE_MAX_ITEMS')) || 50000,
      contextId,
      ttl = 0,
      randomOffset = 9,
    } = options

    if (capacity <= 0) {
      throw new InternalError('QuickLRU: capacity must be greater than 0.')
    }
    super({ contextId, ttl, autoInitialize: false })
    this.randomOffset = randomOffset
    this.capacity = capacity

    this.initialize()
  }

  protected override initialize() {
    this.#cache = new Map<K, CacheEntry<V>>()
  }

  /**
   * Retrieves a value from the cache by key.
   * If the key exists and has not expired, it is moved to the most recently used position.
   *
   * @param key The key to look up.
   * @returns The cached value, or `undefined` if the key is not found or has expired.
   */
  public get<O = V>(key: K): O | undefined {
    const entry = this.#cache.get(key)
    if (!entry) return undefined

    // Check if expired
    if (entry.ttl > 0 && Date.now() > entry.expirationTime) {
      this.#cache.delete(key)
      return undefined
    }

    // Move to most recently used
    this.#cache.delete(key)
    this.#cache.set(key, entry)

    return entry.value as O | undefined
  }

  /**
   * Adds or updates a key-value pair in the cache.
   * If the cache exceeds its capacity, the least recently used entry is evicted.
   *
   * @param key The key to insert or update.
   * @param value The value to store.
   * @param ttl The optional TTL (in seconds)
   */
  public set(key: K, value: V, ttl?: number | 'KEEPTTL'): void {
    // Remove existing entry to update order
    const oldValue = this.#cache.get(key)
    if (oldValue) {
      this.#cache.delete(key)
    }

    const opts = { value, expirationTime: 0, ttl: 0 }
    const msTTL = ttl ?? this.ttl

    const exp = (ttl: number) => ttl > 0 ? Date.now() + ttl * 1000 : 0

    if (msTTL === 'KEEPTTL') {
      opts.expirationTime = oldValue?.expirationTime ?? exp(this.ttl)
      opts.ttl = oldValue?.ttl ?? this.ttl * 1000
    } else {
      const ttlOffset = Math.floor(Math.random() * this.randomOffset) * 1000
      opts.expirationTime = exp(msTTL + ttlOffset / 1000)
      opts.ttl = msTTL * 1000 + ttlOffset
    }

    this.#cache.set(key, opts)

    // Evict least recently used if over capacity
    if (this.#cache.size > this.capacity) {
      const oldestKey = this.#cache.keys().next().value as K
      this.#cache.delete(oldestKey)
    }
  }

  /**
   * Checks whether the cache contains a valid (non-expired) key.
   *
   * @param key The key to check.
   * @returns `true` if the key exists and has not expired, otherwise `false`.
   */
  public has(key: K): boolean {
    const entry = this.#cache.get(key)
    if (!entry) return false

    if (entry.ttl > 0 && Date.now() > entry.expirationTime) {
      this.#cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Deletes a key from the cache.
   *
   * @param key The key to remove.
   * @returns `true` if the key was found and removed, otherwise `false`.
   */
  public delete(key: K): boolean {
    return this.#cache.delete(key)
  }

  /**
   * Clears all entries from the cache.
   */
  public clear(): void {
    this.#cache.clear()
  }

  /**
   * Returns the number of valid (non-expired) items currently stored in the cache.
   */
  public size(): number {
    this.evict()
    return this.#cache.size
  }

  /**
   * Removes all expired items from the cache.
   * This runs automatically during size checks, but can also be called manually.
   */
  private evict(): void {
    const now = Date.now()
    for (const [key, entry] of this.#cache) {
      if (entry.expirationTime > 0 && now > entry.expirationTime) {
        this.#cache.delete(key)
      }
    }
  }

  /**
   * Returns all current (non-expired) keys in the cache.
   */
  public keys(): K[] {
    this.evict()
    return Array.from(this.#cache.keys())
  }

  /**
   * Returns all current (non-expired) values in the cache.
   */
  public values<O = V>(): O[] {
    this.evict()
    return Array.from(this.#cache.values()).map((entry) => entry.value as unknown as O)
  }

  public override isHealthy(): boolean {
    return true
  }

  protected override close() {}
}
