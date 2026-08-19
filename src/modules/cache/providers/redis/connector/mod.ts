import type { RedisOptions } from 'cache/typings/general.ts'

import { clearTimeouts, execWithRetry } from './retries.ts'
import { createClient, type RedisClientType } from 'redis'
import { RedisPipelineScheduler } from './scheduler.ts'
import { type CacheSetOptions, ZanixCacheConnector } from '@zanix/server'
import { InternalError } from '@zanix/errors'
import logger from '@zanix/logger'
import { scanKeys } from './scan.ts'

/**
 * A Redis-backed cache implementation with automatic retry and command queuing.
 *
 * Environment Variables:
 * - **REDIS_URI**: Optional. If set, this URI will be used as the default Redis connection string.
 *   Example: `REDIS_URI="redis://mydomain:6379"`
 *
 * @template K Type of cache keys (must be stringable for Redis).
 * @template V Type of cache values.
 */
// deno-lint-ignore no-explicit-any
export class ZanixRedisConnector<K extends string = string, V = any>
  extends ZanixCacheConnector<K, V, 'redis'> {
  #uri: string
  #client!: RedisClientType
  /** Options that configure the pipeline scheduler used to batch commands. */
  private schedulerOptions: RedisOptions['schedulerOptions']
  /** The connector's display name, used in logs. */
  protected name: string
  /** Lists all keys currently stored in the cache, bound as an instance method. */
  private scanKeys = scanKeys
  /** Retries a Redis command according to the configured retry policy. */
  private execWithRetry = execWithRetry
  /** Reconnect strategy applied when the underlying socket closes unexpectedly. */
  protected reconnectStrategy: RedisOptions['reconnectStrategy']
  /** Delay in milliseconds between retries of a failed command. */
  protected commandRetryInterval: number
  /** Maximum number of retries for a failed command. */
  protected maxCommandRetries: number
  /** Timeout in milliseconds allowed for each Redis command. */
  protected commandTimeout: number
  /** Maximum time in milliseconds to wait for the initial connection before failing. */
  private timeout: number
  #connected = false
  #reconnect = false
  #scheduler!: RedisPipelineScheduler

  /** Whether the underlying client is currently connected and ready. */
  private get connected(): boolean {
    return this.#connected
  }

  private set connected(value: boolean) {
    this.#connected = value
  }

  /** Whether a manual reconnect attempt is in progress. */
  private get reconnect(): boolean {
    return this.#reconnect
  }

  private set reconnect(value: boolean) {
    this.#reconnect = value
  }

  /** The scheduler used to batch and pipeline Redis commands. */
  protected get scheduler(): RedisPipelineScheduler {
    return this.#scheduler
  }

  protected set scheduler(value: RedisPipelineScheduler) {
    this.#scheduler = value
  }

  /**
   * Creates a Redis-backed cache with retries and command queueing.
   *
   * @param options - Redis cache options
   * @param options.ttl Optional TTL in milliseconds for each key
   * @param options.redisUrl Redis connection URL
   * @param options.reconnectStrategy Reconnect strategy when the socket closes unexpectedly. Defaults to exponential backoff
   * @param options.commandTimeout Timeout in milliseconds for each Redis command (default: 2000ms)
   * @param options.maxCommandRetries Number of retries per command if it fails (default: 3)
   */
  constructor(options: RedisOptions = {}) {
    const {
      ttl = 0,
      redisUrl = Deno.env.get('REDIS_URI') || 'redis://localhost:6379',
      maxCommandRetries = 3,
      commandTimeout = 2000,
      reconnectStrategy,
      commandRetryInterval = 100,
      connectionTimeout,
      schedulerOptions,
      contextId,
      autoInitialize,
      maxTTLOffset,
      minTTLForOffset,
    } = options

    super({
      contextId,
      ttl,
      maxOffsetSeconds: maxTTLOffset,
      minTTLForOffset,
      autoInitialize,
    })

    this.#uri = redisUrl
    // `coreDisplayName` (`ZanixConnector`, `@zanix/server`) strips the internal `_Zanix`-prefixed
    // synthetic subclass name a core connector is auto-registered under, falling back to
    // 'cache core' — a no-op for any ordinary, consumer-authored subclass.
    this.name = this.coreDisplayName('cache core')
    this.schedulerOptions = schedulerOptions
    this.commandRetryInterval = commandRetryInterval
    this.maxCommandRetries = maxCommandRetries
    this.commandTimeout = commandTimeout
    this.timeout = connectionTimeout || this.timeoutConnection
    this.reconnectStrategy = reconnectStrategy || ((retries) => {
      // Retry with exponential backoff, max 5 seconds
      return Math.min(retries * 100, 5000)
    })
  }

  /** Creates the underlying Redis client and connects to the server. */
  protected async initialize() {
    this.#client = createClient({
      url: this.#uri,
      socket: { reconnectStrategy: this.reconnectStrategy },
      disableOfflineQueue: false, // Active queue offline until connected
    })

    this.scheduler = new RedisPipelineScheduler(
      this.#client,
      this.execWithRetry,
      this.schedulerOptions,
    )

    let timeInit = Date.now()

    this.#client.on('ready', () => {
      logger.success(
        `Redis Connected Successfully through '${this.name}' class`,
      )
      clearTimeouts()
      this.connected = true
    })

    this.#client.on('reconnecting', () => {
      if (this.connected || this.reconnect) {
        timeInit = Date.now()
        this.connected = false
        this.reconnect = false
      }

      if (Date.now() - timeInit > this.timeout) {
        throw new InternalError(
          `Failed to connect to Redis in '${this.name}' class`,
          {
            code: 'REDIS_CONNECTION_TIMEOUT',
            meta: {
              suggestion: 'Check Redis URI, credentials, and network connectivity',
              connectorName: this.name,
              source: 'zanix',
            },
          },
        )
      }
    })

    this.#client.on('end', () => {
      logger.warn(`Redis connection closed in '${this.name}' class`, 'noSave')
      this.connected = false
    })

    this.#client.on('error', (err) => {
      logger.error(
        'An error ocurred. Retry to connect to Redis...',
        err,
        'noSave',
      )
    })

    // Promise that resolves when the client is ready
    await this.#client.connect()
  }

  /** Helper to reconnect a client  */
  protected async clientReconnect() {
    if (!this.#client.isOpen) {
      this.reconnect = true
      await this.#client.connect()
    }
  }

  /** Stores a value under the given key, optionally scheduling the write and applying a TTL. */
  public async set(
    key: K,
    value: V,
    options: CacheSetOptions = {},
  ): Promise<void> {
    const { exp, schedule, maxTTLOffset, minTTLForOffset } = options
    const ttlValue = exp ?? this.ttl
    const valueToSave = JSON.stringify(value)
    const setterOptions = {
      expiration: ttlValue === 'KEEPTTL' ? ttlValue : ttlValue > 0
        ? {
          type: 'PX' as const,
          value: this.getTTLWithOffset(ttlValue, maxTTLOffset, minTTLForOffset) *
            1000,
        }
        : undefined,
    }

    if (schedule) {
      this.execWithRetry(() => this.scheduler.addSet(key, valueToSave, setterOptions) as never)
    } else await this.execWithRetry(() => this.#client.set(key, valueToSave, setterOptions))
  }

  /** Retrieves the value stored under the given key, or `undefined` if it doesn't exist. */
  public async get<O = V>(key: K): Promise<O | undefined> {
    const val = await this.execWithRetry(() => this.#client.get(key))
    if (val === null) return undefined
    return JSON.parse(val) as O
  }

  /** Checks whether a key currently exists in the cache. */
  public async has(key: K): Promise<boolean> {
    const exists = await this.execWithRetry(() => this.#client.exists(key))
    return exists === 1
  }

  /** Removes a key from the cache, returning whether it was actually deleted. */
  public async delete(key: K): Promise<boolean> {
    const deleted = await this.execWithRetry(() => this.#client.del(key))
    return deleted === 1
  }

  /** Flushes the entire Redis database used by this connector. */
  public async clear(): Promise<void> {
    await this.execWithRetry(() => this.#client.flushDb())
  }

  /** Returns the number of keys currently stored in the cache. */
  public async size(): Promise<number> {
    const k = await this.keys()
    return k.length
  }

  /** Lists all keys currently stored in the cache, optionally filtered by a match pattern. */
  public keys(match?: string): Promise<K[]> {
    return this.scanKeys(match)
  }

  /** Retrieves all values currently stored in the cache. */
  public async values<O = V>(): Promise<O[]> {
    const keys = await this.keys()
    const values = keys.map((key) => this.#client.get(key).then((val) => val && JSON.parse(val)))
    const result = await Promise.all(values)
    return result.filter(Boolean) as O[]
  }

  /** Reports whether the underlying Redis client is currently connected. */
  public override isHealthy(): boolean {
    return this.connected
  }

  /** Gracefully closes the underlying Redis client connection. */
  protected close() {
    try {
      clearTimeouts()
      if (this.#client?.isOpen) {
        this.#client.destroy()
      }
    } catch (e) {
      logger.error(
        `Failed to close Redis in '${this.name}' class`,
        e,
        'noSave',
      )
    }
  }

  /**
   * Returns the underlying Redis client, queued through the retry mechanism.
   *
   * The concrete client type isn't part of this package's public API — pass your own
   * `RedisClientType` (from the `redis` package) as `T` if you need it typed.
   */
  public getClient<T = Promise<RedisClientType>>(): T {
    return this.execWithRetry(() => this.#client) as T
  }
}
