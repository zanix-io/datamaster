/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * This module provides cache connectors and utilities for the Zanix project.
 *
 * It includes the Redis connector, the local LRU (QLRU) connector, and the multi-layer
 * cache provider that combines them with configurable fetch/revalidate strategies.
 *
 * @module zanixCache
 */

export {
  /** Core cache provider with multi-level caching (local + external). */
  ZanixCacheCoreProvider,
} from './providers/mod.ts'
export {
  /** A fast and lightweight Least Recently Used (LRU) cache with optional TTL support. */
  ZanixQLRUConnector,
} from './providers/qlru/connector.ts'
export {
  /** A Redis-backed cache implementation with automatic retry and command queuing. */
  ZanixRedisConnector,
} from './providers/redis/connector/mod.ts'

// Utils, extensions
export {
  /** Returns all keys currently stored in the redis cache. */
  scanKeys,
} from './providers/redis/connector/scan.ts'

// Types
export type {
  /** Represents a single Expired Value entry. */
  ExpiredValueEntry,
} from 'database/typings/general.ts'
export type {
  /** Redis cache connector options. */
  RedisOptions,
} from './typings/general.ts'
export type {
  /** Helper that batches Redis commands and executes them in scheduled pipelines. */
  RedisPipelineScheduler,
} from './providers/redis/connector/scheduler.ts'
