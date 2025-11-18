import type { KVEntry } from 'database/typings/general.ts'
import type { Database } from 'sqlite3'

import { ZanixKVConnector } from '@zanix/server'
import { LocalSQLite } from 'database/utils/sqlite.ts'
import { LockManager } from 'utils/queues/lock-manager.ts'

/**
 * A lightweight and fast key-value local store backed by SQLite, with optional TTL (Time-To-Live) support.
 *
 * Provides methods to get, set, delete, and clear entries, as well as execute operations under
 * a per-key exclusive lock.
 *
 * @template V - Type of the value stored in the KV store.
 */
// deno-lint-ignore no-explicit-any
export class ZanixKVStoreConnector<V = any> extends ZanixKVConnector {
  #sqlite!: LocalSQLite
  private keyLockManager = new LockManager() // Exclusive lock per key, only one function runs at a time by default
  private filename: string

  /**
   * Creates a new KV store instance scoped to an optional context.
   *
   * @param {string} [options.contextId] - Optional context identifier to scope this instance.
   * @param {string} [options.filename] - Optional db filename. Defaults to `znx.kv.tmp`
   */
  constructor(options: { contextId?: string; filename?: string } = {}) {
    super({
      contextId: options.contextId,
      autoInitialize: false,
    })
    this.filename = options.filename || 'znx.kv.tmp'
    if (!this['_znx_props_'].data.autoInitialize) this.initialize()
  }

  /**
   * Initializes the SQLite table for storing key-value entries.
   * Called internally during construction.
   */
  protected override initialize() {
    this.#sqlite = new LocalSQLite('znx_kv', this.filename)
    this.#sqlite.createTable<Record<keyof KVEntry<string>, string>>(
      {
        key: 'TEXT',
        value: 'TEXT',
        expirationTime: 'INTEGER',
        ttl: 'INTEGER',
      },
      { primaryKey: ['key'] },
    )
  }

  /**
   * Retrieves a value by key from the KV store.
   * Returns `undefined` if the key does not exist or has expired.
   *
   * @template O - Expected type of the returned value.
   * @param key - The key to retrieve.
   * @returns The cached value or `undefined`.
   */
  public get<O = V>(key: string): O | undefined {
    const entry = this.#sqlite.getDataByKey<KVEntry<string>>({ key })

    if (!entry) return undefined

    // Check if expired
    if (entry.ttl > 0 && Date.now() > entry.expirationTime) {
      this.#sqlite.deleteByKey({ key })
      return undefined
    }

    return JSON.parse(entry.value) as O | undefined
  }

  /**
   * Adds or updates a key-value pair in the KV store.
   *
   * Supports optional TTL in seconds. If `exp` is `"KEEPTTL"`, the previous TTL is retained.
   *
   * @param key - The key to store.
   * @param value - The value to store.
   * @param exp - TTL in seconds, or `"KEEPTTL"` to retain the existing TTL (default `0`).
   */
  public set(key: string, value: V, exp: number | 'KEEPTTL' = 0): void {
    // Remove existing entry to update order
    const oldValue = this.#sqlite.getDataByKey<KVEntry<string>>({ key })

    const data = { value: JSON.stringify(value), expirationTime: 0, ttl: 0 }

    const expire = (ttl: number) => ttl > 0 ? Date.now() + ttl * 1000 : 0

    if (exp === 'KEEPTTL') {
      data.expirationTime = oldValue?.expirationTime ?? 0
      data.ttl = oldValue?.ttl ?? 0
    } else {
      data.expirationTime = expire(exp)
      data.ttl = exp * 1000
    }

    this.#sqlite.insertOrUpdateData({ ...data, key })
  }

  /**
   * Deletes a key from the KV store.
   *
   * @param key - The key to delete.
   */
  public delete(key: string) {
    this.#sqlite.deleteByKey({ key })
  }

  /**
   * Clears all entries from the KV store.
   */
  public clear(): void {
    this.#sqlite.flush()
  }

  /**
   * Checks whether the KV connector is healthy.
   *
   * @returns `true` if healthy.
   */
  public override isHealthy(): boolean {
    return this.#sqlite.db.open
  }

  /**
   * Closes the underlying SQLite database connection.
   */
  protected override close() {
    this.#sqlite.db.close()
  }

  /**
   * Retrieves the raw SQLite database client.
   *
   * @returns The SQLite Database instance.
   */
  public getClient<T = Database>(): T {
    return this.#sqlite.db as T
  }

  /**
   * Executes an asynchronous function under an exclusive lock for a specific key.
   *
   * Ensures that only one operation at a time runs per key. Calls with different keys
   * can execute in parallel.
   *
   * **Note:**
   * - This is an in-memory lock. For distributed systems, use a distributed lock (e.g., Redis).
   *
   * @template T - Return type of the function.
   * @param key - Key to lock on.
   * @param fn - Async function to execute once the lock is acquired.
   * @returns A promise resolving with the result of the function.
   */
  public withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    return this.keyLockManager.withLock<T>(key, fn)
  }
}
