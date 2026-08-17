/**
 * SQLite — split from `database/mod.ts` into its own entry point (`@zanix/datamaster/sqlite`)
 * because `@db/sqlite`'s native FFI binding loads eagerly the moment ITS OWN module is imported,
 * regardless of whether a `Database`/`LocalSQLite`/`ZanixKVStoreConnector` instance is ever
 * constructed — so any consumer who only needs `ZanixMongoConnector`/`ZanixRedisConnector` (the
 * common case) was previously forced to also request `--allow-ffi` just by importing this
 * package's main entry point, with no runtime dependency on SQLite at all.
 *
 * @module
 */

export {
  /** A lightweight and fast key-value local store backed by SQLite, with optional TTL support. */
  ZanixKVStoreConnector,
} from 'sqlite/connector.ts'
export {
  /** Base class for interacting with a local SQLite database. */
  LocalSQLite,
} from './utils/sqlite.ts'
