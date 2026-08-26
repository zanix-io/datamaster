import type { CacheSetOptions, ZanixCacheConnector, ZanixCacheProvider } from '@zanix/server'

/**
 * Minimal Redis client contract exposed to Zanix modules.
 *
 * This interface defines only the Redis commands required by Zanix consumers,
 * keeping them independent from the concrete Redis client implementation.
 *
 * The underlying Redis client may be implemented by any compatible library,
 * as long as it provides the operations defined by this contract.
 *
 * @typeParam K - Type of Redis keys accepted by the client.
 */
export interface ZanixRedisClientLike<K extends string = string> {
  /**
   * Stores a value in Redis, optionally applying Redis-specific conditions
   * and expiration settings.
   *
   * When `NX` is enabled, the value is only stored if the key does not
   * already exist. When `EX` is provided, the key expires after the specified
   * number of seconds.
   *
   * @param key - Redis key where the value should be stored.
   * @param value - Value to store.
   * @param options - Redis-specific options controlling the set operation.
   * @param options.NX - Only set the value when the key does not already exist.
   * @param options.EX - Expiration time in seconds.
   * @returns `OK` when the value was stored, or `null` when `NX` is enabled
   *   and the key already exists.
   */
  set(
    key: K,
    value: string,
    options?: CacheSetOptions & {
      NX?: boolean
      EX?: number
    },
  ): Promise<'OK' | null>

  /**
   * Creates a duplicate of the current Redis client.
   *
   * The duplicated client has its own Redis connection and can be used
   * independently from the original client, which is useful for operations
   * such as subscriptions that change the connection state.
   *
   * @returns A new Redis client instance with the same configuration.
   */
  duplicate(): ZanixRedisClientLike<K>

  /**
   * Subscribes to a Redis Pub/Sub channel.
   *
   * The listener is invoked whenever a message is published to the channel.
   *
   * @param channel - Redis channel to subscribe to.
   * @param listener - Callback invoked with each received message.
   * @returns A promise that resolves once the subscription has been registered.
   */
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<void>

  /**
   * Establishes a connection to the Redis server.
   *
   * @returns A promise that resolves once the connection has been established.
   */
  connect(): Promise<void>

  /**
   * Publishes a message to a Redis Pub/Sub channel.
   *
   * @param channel - Redis channel to which the message should be published.
   * @param message - Message to publish.
   * @returns The number of clients that received the published message.
   */
  publish(channel: string, message: string): Promise<number>

  /**
   * Removes the client's subscriptions from Redis Pub/Sub channels.
   *
   * When no channel is provided, all active subscriptions are removed.
   *
   * @param channel - Optional Redis channel to unsubscribe from. When omitted,
   *   all active subscriptions are removed.
   * @returns A promise that resolves once the unsubscribe operation completes.
   */
  unsubscribe(channel?: string): Promise<void>

  /**
   * Closes the Redis client connection.
   *
   * This method should be called when the client is no longer needed to release
   * the underlying Redis connection and associated resources.
   *
   * @returns A promise that resolves once the connection has been closed.
   */
  close(): Promise<void>

  /**
   * Atomically increments the integer value stored at the given key.
   *
   * @param key - Key of the integer value to increment.
   * @returns The value of the key after the increment.
   */
  incr(key: K): Promise<number>

  /**
   * Adds a member to a Redis set.
   *
   * @param key - Key of the set.
   * @param member - Member to add.
   * @returns `1` when the member was added, or `0` when it was already
   *   present in the set.
   */
  sAdd(key: K, member: string): Promise<number>

  /**
   * Removes one or more members from a Redis set.
   *
   * @param key - Key of the set.
   * @param member - Member, or members, to remove.
   * @returns The number of members that were removed.
   */
  sRem(key: K, member: string | string[]): Promise<number>

  /**
   * Returns all members currently stored in a Redis set.
   *
   * @param key - Key of the set.
   * @returns All members of the set.
   */
  sMembers(key: K): Promise<string[]>

  /**
   * Executes a Lua script atomically on the Redis server.
   *
   * The script receives the supplied keys through Redis `KEYS` and the
   * supplied arguments through Redis `ARGV`.
   *
   * @typeParam T - Expected type of the script result.
   * @param script - Lua script to execute.
   * @param options - Keys and arguments passed to the script.
   * @param options.keys - Redis keys referenced by the script.
   * @param options.arguments - String arguments passed to the script.
   * @returns The value returned by the executed script.
   */
  eval<T = unknown>(
    script: string,
    options: {
      keys: string[]
      arguments: string[]
    },
  ): Promise<T>
}

/**
 * Redis cache connector exposed by Zanix modules.
 *
 * This abstraction provides access to the underlying Redis client while
 * keeping modules decoupled from the concrete Redis client implementation.
 *
 * @typeParam K - Type of Redis keys accepted by the connector.
 */
export interface ZanixRedisConnectorLike<K extends string = string> extends
  // deno-lint-ignore no-explicit-any
  ZanixCacheConnector<any, any, 'redis'> {
  /**
   * Returns the underlying Redis client.
   *
   * The generic return type allows consumers to narrow the client to a
   * compatible interface when additional Redis operations are required.
   *
   * @typeParam T - Type used to represent the Redis client.
   * @returns The underlying Redis client instance.
   */
  getClient: <T = Promise<ZanixRedisClientLike<K>>>() => T
}

/**
 * Cache modules available to the Control Plane.
 *
 * Provides a Redis-backed cache connector through the `redis` property.
 *
 * @typeParam K - Type of Redis keys accepted by the Redis connector.
 */
export type ControlPlaneCacheModules<K extends string = string> = ZanixCacheProvider<
  object,
  { redis: ZanixRedisConnectorLike<K> }
>
