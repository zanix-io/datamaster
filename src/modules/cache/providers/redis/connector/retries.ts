import { InternalError } from '@zanix/errors'
import type { ZanixRedisConnector } from './mod.ts'

const timeoutIds: number[] = []

/** Helper to clear timeouts */
export function clearTimeouts() {
  timeoutIds.forEach((t) => clearTimeout(t))
  timeoutIds.length = 0
}

/** Helper to retry a command with timeout */
export async function execWithRetry<T, K extends string, V>(
  this: ZanixRedisConnector<K, V>,
  fn: () => Promise<T>,
  attempt: number = 0,
): Promise<T> {
  if (this['connected']) return fn()

  const ensureReadyFn = async () => {
    try {
      // ensure ready
      await this.isReady
    } catch (e) {
      // If connection retries timed out, reconnect only when needed.
      this.close()
      await this.clientReconnect()

      throw e
    }
    return fn()
  }

  const command = Promise.race([
    ensureReadyFn(),
    new Promise<T>((_, reject) =>
      timeoutIds.push(setTimeout(
        () =>
          reject(
            new InternalError(
              `Failed to connect to Redis in '${this.name}' class`,
              { code: 'REDIS_COMMAND_TIMEOUT', meta: { source: 'zanix' } },
            ),
          ),
        this.commandTimeout,
      ))
    ),
  ])

  try {
    return await command
  } catch (err) {
    const error = err as InternalError
    if (attempt >= this.maxCommandRetries - 1 || error.code === 'REDIS_CONNECTION_TIMEOUT') {
      throw error
    }
    return await new Promise<T>((resolve) =>
      timeoutIds.push(
        setTimeout(
          () => resolve(this['execWithRetry'](ensureReadyFn, attempt + 1)),
          this.commandRetryInterval,
        ),
      )
    )
  }
}
