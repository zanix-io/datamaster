import type { RedisOptions } from 'cache/typings/general.ts'
import type { RedisClientType } from 'redis'

import logger from '@zanix/logger'

/**
 * Helper that batches Redis commands and executes them
 * either when the batch reaches a maximum size
 * or when a maximum delay has elapsed — whichever comes first.
 */
export class RedisPipelineScheduler {
  /** The Redis client used to build and execute the pipeline. */
  private redis: RedisClientType
  /** Maximum number of commands per batch before an immediate flush is triggered. */
  private maxBatch: number
  /** Maximum delay, in milliseconds, before a pending batch is flushed. */
  private maxDelay: number

  /** The Redis pipeline currently accumulating queued commands. */
  private pipeline: ReturnType<RedisClientType['multi']>
  /** Number of commands queued in the current pipeline. */
  private counter = 0
  /** Handle of the pending flush timer, if one is scheduled. */
  private timer: NodeJS.Timeout | number | null = null
  /** Whether a flush is currently in progress. */
  private flushing = false

  /**
   * Creates a scheduler that batches commands for the given Redis client.
   *
   * @param redis - An ioredis client instance.
   * @param options - Configuration options.
   * @param options.maxBatch - Maximum number of commands per batch (default: 200).
   * @param options.maxDelay - Maximum delay in milliseconds before flushing (default: 100ms).
   */
  constructor(
    redis: RedisClientType,
    /** Wraps a Redis command execution with the connector's retry logic. */
    private execWithRetry: (fn: () => Promise<unknown>) => Promise<unknown>,
    { maxBatch = 200, maxDelay = 100 }: NonNullable<
      RedisOptions['schedulerOptions']
    > = {},
  ) {
    this.redis = redis
    this.maxBatch = maxBatch
    this.maxDelay = maxDelay
    this.pipeline = this.redis.multi()
  }

  /**
   * Adds a command to the current pipeline and automatically schedules a flush
   * when the batch size or delay threshold is reached.
   *
   * @param key - Cache key to set.
   * @param value - Value to store.
   * @param exp - Optional TTL (in seconds).
   */
  public addSet(key: string, value: string, exp?: unknown) {
    this.pipeline.set(key, value, exp)

    this.counter++

    // Flush immediately if batch size reached
    if (this.counter >= this.maxBatch) {
      void this.flush()
      return
    }

    // Otherwise, start timer if not already active

    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.maxDelay)
    }
  }

  /**
   * Forces a flush of the current pipeline (sending commands to Redis).
   * Safe to call multiple times; concurrent calls will be serialized.
   */
  public async flush(): Promise<void> {
    if (this.flushing || this.counter === 0) return

    this.flushing = true
    try {
      await this.execWithRetry(() => this.pipeline.exec())
    } catch (err) {
      logger.error(
        '[RedisPipelineScheduler] Pipeline flush error:',
        err,
        'noSave',
      )
    } finally {
      this.pipeline = this.redis.multi()
      this.counter = 0
      this.flushing = false
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
    }
  }

  /**
   * Flushes and clears any pending operations.
   * Should be called before shutdown to avoid losing data.
   */
  public async shutdown(): Promise<void> {
    await this.flush()
  }
}
