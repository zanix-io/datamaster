import type { ConnectorOptions } from '@zanix/server'

/**
 * Represents a single cache entry in the QuickLRU cache.
 */
export interface CacheEntry<V> {
  value: V
  expirationTime: number // 0 if no TTL
  ttl: number // ttl saved in milliseconds
}

/** Quick LRU cache options */
export type QLRUCacheOptions = ConnectorOptions & {
  capacity?: number
  /** The time-to-live (TTL) in seconds */
  ttl?: number
  /**
   * Maximum random TTL offset, in seconds.
   * A random value between 0 and this number will be added to the base TTL.
   * Defaults to 9 (0–9).
   */
  maxTTLOffset?: number
  /**
   * Minimum TTL in seconds required for the offset to be applied.
   * Defaults to 5.
   */
  minTTLForOffset?: number
}

/**
 * Redis cache connector options
 */
export type RedisOptions = ConnectorOptions & {
  /**
   * Strategy for reconnecting to Redis. Can be:
   * - A number representing the time in milliseconds between reconnection attempts.
   * - `false` to disable automatic reconnection.
   * - A custom function that receives the number of retries and an error object, and returns:
   *   - `false` to stop reconnection attempts.
   *   - A number (in milliseconds) to define the time to wait before the next attempt.
   *   - An `Error` to throw after a certain number of retries.
   */
  reconnectStrategy?:
    | number
    | false
    | ((retries: number, cause: Error) => false | number | Error)
  /**
   * The prefix for Redis keys. Used to add a namespace to the keys stored in Redis.
   * If not provided, it defaults to `undefined`, meaning no prefix is used for keys.
   */
  namespace?: string
  /**
   * The maximum time (in milliseconds) to wait for a Redis command to execute before it is considered a timeout error.
   * Defaults to `2000ms`
   */
  commandTimeout?: number
  /**
   * The maximum number of command retry attempts. If this number is exceeded, the client will stop retrying the command and it will fail.
   * Defaults to `3` attempts.
   */
  maxCommandRetries?: number
  /**
   * The interval (in milliseconds) between each retry when attempting to execute a command. Defaults to **100ms**.
   */
  commandRetryInterval?: number
  /**
   * The maximum time (in milliseconds) to wait for the Redis socket connection to be established.
   * If not set, System uses its default connection timeout.
   */
  connectionTimeout?: number
  /**
   * The full URL to connect to the Redis server. It can include the protocol (e.g., `redis://` or `rediss://` for secure connections),
   * the host, port, and credentials (e.g., `redis://user:password@localhost:6379`).
   */
  redisUrl?: string
  /**
   * The time-to-live (TTL) for Redis keys, in seconds. If set, Redis keys will automatically expire after the specified time.
   * If not set, keys will not expire by default.
   */
  ttl?: number
  /**
   * Maximum random TTL offset, in seconds.
   * A random value between 0 and this number will be added to the base TTL.
   * Defaults to 9 (0–9).
   */
  maxTTLOffset?: number
  /**
   * Minimum TTL in seconds required for the offset to be applied.
   * Defaults to 5.
   */
  minTTLForOffset?: number
  /**
   * Options to batches redis commands and executes them
   * either when the batch reaches a maximum size
   * or when a maximum delay has elapsed — whichever comes first.
   */
  schedulerOptions?: {
    /**
     * Maximum number of commands per batch (default: 200).
     */
    maxBatch?: number
    /**
     * Maximum delay in milliseconds before flushing (default: 100ms).
     */
    maxDelay?: number
  }
}
