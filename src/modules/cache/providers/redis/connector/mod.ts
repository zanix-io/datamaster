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
  private schedulerOptions: RedisOptions['schedulerOptions']
  protected name: string
  private scanKeys = scanKeys
  private execWithRetry = execWithRetry
  private accessor connected = false
  private accessor reconnect = false
  protected accessor scheduler!: RedisPipelineScheduler
  protected reconnectStrategy: RedisOptions['reconnectStrategy']
  protected commandRetryInterval: number
  protected maxCommandRetries: number
  protected commandTimeout: number
  private timeout: number

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

    super({ contextId, ttl, maxOffsetSeconds: maxTTLOffset, minTTLForOffset, autoInitialize })

    this.#uri = redisUrl
    const targetName = this.constructor.name
    this.name = targetName.startsWith('_Zanix') ? 'cache core' : targetName
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
      logger.success(`Redis Connected Successfully through '${this.name}' class`)
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
      logger.error('An error ocurred. Retry to connect to Redis...', err, 'noSave')
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

  public async set(key: K, value: V, options: CacheSetOptions = {}): Promise<void> {
    const { exp, schedule, maxTTLOffset, minTTLForOffset } = options
    const ttlValue = exp ?? this.ttl
    const valueToSave = JSON.stringify(value)
    const setterOptions = {
      expiration: ttlValue === 'KEEPTTL' ? ttlValue : ttlValue > 0
        ? {
          type: 'PX' as const,
          value: this.getTTLWithOffset(ttlValue, maxTTLOffset, minTTLForOffset) * 1000,
        }
        : undefined,
    }

    if (schedule) {
      this.execWithRetry(() => this.scheduler.addSet(key, valueToSave, setterOptions) as never)
    } else await this.execWithRetry(() => this.#client.set(key, valueToSave, setterOptions))
  }

  public async get<O = V>(key: K): Promise<O | undefined> {
    const val = await this.execWithRetry(() => this.#client.get(key))
    if (val === null) return undefined
    return JSON.parse(val) as O
  }

  public async has(key: K): Promise<boolean> {
    const exists = await this.execWithRetry(() => this.#client.exists(key))
    return exists === 1
  }

  public async delete(key: K): Promise<boolean> {
    const deleted = await this.execWithRetry(() => this.#client.del(key))
    return deleted === 1
  }

  public async clear(): Promise<void> {
    await this.execWithRetry(() => this.#client.flushDb())
  }

  public async size(): Promise<number> {
    const k = await this.keys()
    return k.length
  }

  public keys(match?: string): Promise<K[]> {
    return this.scanKeys(match)
  }

  public async values<O = V>(): Promise<O[]> {
    const keys = await this.keys()
    const values = keys.map((key) => this.#client.get(key).then((val) => val && JSON.parse(val)))
    const result = await Promise.all(values)
    return result.filter(Boolean) as O[]
  }

  public override isHealthy(): boolean {
    return this.connected
  }

  protected close() {
    try {
      clearTimeouts()
      if (this.#client?.isOpen) {
        this.#client.destroy()
      }
    } catch (e) {
      logger.error(`Failed to close Redis in '${this.name}' class`, e, 'noSave')
    }
  }

  public getClient<T = Promise<RedisClientType>>(): T {
    return this.execWithRetry(() => this.#client) as T
  }
}
