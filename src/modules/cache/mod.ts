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

import type { RedisClientType } from 'redis'

export { ZanixCacheCoreProvider } from './providers/mod.ts'
export { ZanixQLRUConnector } from './providers/qlru/connector.ts'
export { ZanixRedisConnector } from './providers/redis/connector/mod.ts'

// Utils, extensions
export { scanKeys } from './providers/redis/connector/scan.ts'

// Types
export type {
  /**
   * Redis client type
   */
  RedisClientType,
}
export type { ExpiredValueEntry } from 'database/typings/general.ts'
export type { RedisOptions } from './typings/general.ts'
export type { RedisPipelineScheduler } from './providers/redis/connector/scheduler.ts'
