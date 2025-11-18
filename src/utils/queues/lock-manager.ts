import { Semaphore } from './semaphore.ts'

/**
 * Manages keyed locks using semaphores to ensure controlled, concurrent access
 * to resources identified by a specific key.
 *
 * This class provides a simple and efficient way to synchronize asynchronous
 * operations that should not run concurrently for the same key, while still
 * allowing parallel execution for different keys.
 *
 * Each key is associated with its own {@link Semaphore}, allowing granular
 * locking behavior. By default, each key allows only one active operation
 * at a time (exclusive lock), but the number of permits can be configured.
 *
 * @example
 * const lockManager = new LockManager(1); // Exclusive lock per key
 *
 * async function updateUserData(userId, data) {
 *   await lockManager.withLock(`user:${userId}`, async () => {
 *     // Only one update runs at a time for this userId
 *     await saveToDatabase(data);
 *   });
 * }
 *
 * @class
 */
export class LockManager {
  private locks: Map<string, Semaphore> = new Map()
  private readonly permitsPerKey: number

  constructor(permitsPerKey = 1) {
    this.permitsPerKey = permitsPerKey // normalmente 1 para un lock exclusivo
  }

  private getSemaphore(key: string): Semaphore {
    let sem = this.locks.get(key)
    if (!sem) {
      sem = new Semaphore(this.permitsPerKey)
      this.locks.set(key, sem)
    }
    return sem
  }

  public async withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const sem = this.getSemaphore(key)

    await sem.acquire()

    try {
      return await fn()
    } finally {
      const idle = sem.release()

      if (idle && sem.permits > 0) {
        this.locks.delete(key) // clean map
      }
    }
  }
}
