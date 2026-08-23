import type { MemcachedOptions } from 'cache/typings/general.ts'
import { type CacheSetOptions, ZanixCacheConnector } from '@zanix/server'
import { InternalError } from '@zanix/errors'
import logger from '@zanix/logger'
import { MemcachedProtocolClient, toMemcachedExptime, withTimeout } from './client.ts'

const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 11211

/** Env var name for the constructor option that also accepts one (`memcachedUri`) — see the
 * class-level doc. Exported so other packages can set/read it without redefining the literal
 * string. */
export const MEMCACHED_URI_ENV = 'MEMCACHED_URI'

/**
 * A Memcached-backed cache implementation using the classic Memcached text protocol over a raw
 * `Deno.connect` TCP socket — no external client dependency.
 *
 * Environment Variables:
 * - **MEMCACHED_URI**: Optional. `host:port` of the Memcached server. Example:
 *   `MEMCACHED_URI="localhost:11211"`. Defaults to `localhost:11211`.
 *
 * **Design tradeoff you should know about before relying on `keys()`/`values()`/`size()`**: unlike
 * Redis's `SCAN`/`DBSIZE`, the classic Memcached protocol has no command that lists every key or
 * reports the item count. The alternative some deployments expose, `stats items`/`stats
 * cachedump`, is commonly disabled in production (it's an O(n) debugging tool over the whole slab
 * allocator, not a stable API) and was deliberately not relied on here. Instead, `keys()`/
 * `values()`/`size()` are backed by a **per-instance, in-memory index** of the keys this exact
 * connector instance has itself written via `set()`, pruned lazily on read (each read confirms
 * the key still exists server-side, so expired/evicted entries drop out on their own). That means:
 * - A key set through a *different* connector instance, a different process, or a raw client
 *   talking to the same Memcached server is invisible to these three methods — this is a real,
 *   unavoidable limitation of the protocol, not a bug to file.
 * - `size()`/`keys()`/`values()` are only ever a lower bound on what the server actually holds.
 *
 * Don't treat these three methods as an authoritative inventory of a shared Memcached instance —
 * only of what this connector instance itself put there. `get`/`set`/`has`/`delete`/`clear` all
 * talk to the real server directly and don't have this limitation.
 *
 * **`clear()` flushes the *entire* Memcached instance** (`flush_all`) — the same shared-instance
 * footgun `ZanixRedisConnector.clear()` already documents for Redis. If the same Memcached
 * instance is shared with anything else, `clear()` wipes all of it — never call it against a
 * shared instance without confirming nothing else depends on it.
 *
 * **`CacheSetOptions.exp: 'KEEPTTL'` is not supported**: the classic protocol exposes no command
 * to read a key's remaining TTL, so there's no way to actually preserve it on overwrite (only to
 * guess, which would silently misbehave) — `set()` throws instead of pretending to honor it.
 *
 * @template K Type of cache keys (must be a string; see Memcached's own 250-byte/no-whitespace
 * key constraints, enforced by `assertValidMemcachedKey`).
 * @template V Type of cache values.
 */
// deno-lint-ignore no-explicit-any
export class ZanixMemcachedConnector<K extends string = string, V = any>
  extends ZanixCacheConnector<K, V, 'memcached'> {
  #client!: MemcachedProtocolClient
  /** Keys this connector instance has itself written — see the class-level "Design tradeoff" note. */
  #localKeys = new Set<K>()
  #host: string
  #port: number
  #connectTimeout: number
  /** The connector's display name, used in logs. */
  protected name: string

  /**
   * Creates a Memcached-backed cache using the classic text protocol.
   *
   * @param options - Memcached cache options
   * @param options.ttl Optional TTL in seconds for each key
   * @param options.memcachedUri `host:port` of the Memcached server
   * @param options.connectionTimeout Timeout in milliseconds for the initial TCP connection
   */
  constructor(options: MemcachedOptions = {}) {
    const {
      ttl = 0,
      memcachedUri = Deno.env.get(MEMCACHED_URI_ENV) || `${DEFAULT_HOST}:${DEFAULT_PORT}`,
      connectionTimeout,
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

    const [host, portRaw] = memcachedUri.split(':')
    this.#host = host || DEFAULT_HOST
    this.#port = Number(portRaw) || DEFAULT_PORT
    // `coreDisplayName` (`ZanixConnector`, `@zanix/server`) strips the internal `_Zanix`-prefixed
    // synthetic subclass name a core connector is auto-registered under, falling back to
    // 'cache core' — a no-op for any ordinary, consumer-authored subclass.
    this.name = this.coreDisplayName('cache core')
    this.#connectTimeout = connectionTimeout || this.timeoutConnection
  }

  /** Opens the underlying TCP connection to the Memcached server. */
  protected async initialize() {
    this.#client = new MemcachedProtocolClient(this.#host, this.#port, this.#connectTimeout)
    await this.#client.connect()
    logger.success(`Memcached Connected Successfully through '${this.name}' class`)
  }

  /**
   * Resolves to the underlying protocol client once the connector is ready, bounding the wait to
   * `connectionTimeout` — without this, a command issued before `initialize()` finishes would sit
   * on `this.isReady` for as long as the base class's own internal retry loop runs (up to its
   * `timeoutConnection`, 10s by default), instead of failing fast with a clear error.
   */
  async #ready(): Promise<MemcachedProtocolClient> {
    if (this.#client?.connected) return this.#client

    await withTimeout(
      this.isReady,
      this.#connectTimeout,
      `Failed to connect to Memcached at ${this.#host}:${this.#port}`,
    )
    return this.#client
  }

  /**
   * Stores a value under the given key, applying a TTL when configured. Does not support
   * `exp: 'KEEPTTL'` — see the class-level caution. `options.schedule` is a Redis-specific
   * pipelining hint (see `CacheSetOptions`) — this connector has no batching layer, so it's
   * accepted but silently ignored; every write happens synchronously against the server.
   */
  public async set(key: K, value: V, options: CacheSetOptions = {}): Promise<void> {
    const { exp, maxTTLOffset, minTTLForOffset } = options

    if (exp === 'KEEPTTL') {
      throw new InternalError(
        `Memcached does not support 'exp: KEEPTTL' for key '${key}'`,
        {
          code: 'MEMCACHED_KEEPTTL_UNSUPPORTED',
          meta: {
            key,
            suggestion:
              "The classic Memcached protocol exposes no command to read a key's remaining TTL, so it cannot be genuinely preserved on overwrite — pass an explicit exp (seconds) instead",
            source: 'zanix',
          },
        },
      )
    }

    const baseTtl = exp ?? this.ttl
    const ttlSeconds = baseTtl > 0
      ? this.getTTLWithOffset(baseTtl, maxTTLOffset, minTTLForOffset)
      : baseTtl
    const payload = new TextEncoder().encode(JSON.stringify(value))

    const client = await this.#ready()
    await client.set(key, payload, toMemcachedExptime(ttlSeconds))
    this.#localKeys.add(key)
  }

  /** Retrieves the value stored under the given key, or `undefined` if it doesn't exist. */
  public async get<O = V>(key: K): Promise<O | undefined> {
    const client = await this.#ready()
    const data = await client.get(key)
    if (data === undefined) {
      this.#localKeys.delete(key)
      return undefined
    }
    return JSON.parse(new TextDecoder().decode(data)) as O
  }

  /** Checks whether a key currently exists in the cache. */
  public async has(key: K): Promise<boolean> {
    const client = await this.#ready()
    const data = await client.get(key)
    if (data === undefined) {
      this.#localKeys.delete(key)
      return false
    }
    return true
  }

  /** Removes a key from the cache, returning whether it was actually deleted. */
  public async delete(key: K): Promise<boolean> {
    const client = await this.#ready()
    const deleted = await client.delete(key)
    this.#localKeys.delete(key)
    return deleted
  }

  /** Flushes the entire Memcached instance used by this connector — see the class-level caution. */
  public async clear(): Promise<void> {
    const client = await this.#ready()
    await client.flushAll()
    this.#localKeys.clear()
  }

  /**
   * Returns the number of keys currently known to this connector instance — a lower bound on
   * what the shared Memcached server actually holds. See the class-level "Design tradeoff" note.
   */
  public async size(): Promise<number> {
    const keys = await this.keys()
    return keys.length
  }

  /**
   * Lists the keys this connector instance has itself written and that still exist server-side —
   * NOT an authoritative inventory of the shared Memcached instance. See the class-level "Design
   * tradeoff" note.
   */
  public async keys(): Promise<K[]> {
    const alive: K[] = []
    for (const key of this.#localKeys) {
      // Inherently sequential — each `has()` call goes over the one shared, FIFO-queued
      // connection (see `MemcachedProtocolClient`), so there's nothing here for `Promise.all` to
      // parallelize; issuing these concurrently would just queue behind each other anyway.
      // deno-lint-ignore no-await-in-loop
      if (await this.has(key)) alive.push(key)
    }
    return alive
  }

  /** Retrieves the values for every key currently returned by `keys()`. See the same caveat. */
  public async values<O = V>(): Promise<O[]> {
    const keys = await this.keys()
    const values = await Promise.all(keys.map((key) => this.get<O>(key)))
    return values.filter((value) => value !== undefined) as O[]
  }

  /** Reports whether the underlying TCP connection to Memcached is currently open. */
  public override isHealthy(): boolean {
    return this.#client?.connected ?? false
  }

  /** Gracefully closes the underlying TCP connection. */
  protected close() {
    try {
      this.#client?.close()
    } catch (e) {
      logger.error(`Failed to close Memcached in '${this.name}' class`, e, 'noSave')
    }
  }

  /**
   * Returns the underlying protocol client.
   *
   * The concrete client type isn't part of this package's public API — it's a low-level
   * `MemcachedProtocolClient` wrapping the raw TCP socket, exposed for anything not covered by
   * the connector's own methods.
   */
  public getClient<T = MemcachedProtocolClient>(): T {
    return this.#client as T
  }
}
