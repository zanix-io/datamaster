/**
 * A Semaphore implementation that controls access to a shared resource by multiple
 * concurrent processes or tasks, allowing a fixed number of permits for resource access.
 *
 * A semaphore is useful when you want to limit the number of concurrent operations
 * that can be performed on a specific resource. If there are no available permits,
 * tasks will be queued until one becomes available.
 *
 * This implementation uses a queue to manage waiting tasks and provides methods to
 * acquire and release permits.
 *
 * @example
 * const semaphore = new Semaphore(2); // Allows 2 concurrent tasks
 *
 * // Task 1
 * async function task1() {
 *   await semaphore.acquire();
 *   // Perform some work
 *   semaphore.release();
 * }
 *
 * // Task 2
 * async function task2() {
 *   await semaphore.acquire();
 *   // Perform some work
 *   semaphore.release();
 * }
 *
 * @class
 */
export class Semaphore {
  private queue: (() => void)[] = []
  public permits: number

  /**
   * Creates an instance of a Semaphore with a specified number of permits.
   *
   * @param {number} permits - The number of permits available for concurrent tasks.
   *                            Tasks will wait if there are no permits available.
   */
  constructor(permits: number) {
    this.permits = permits
  }

  /**
   * Acquires a permit for a task. If no permits are available, the task will wait until
   * one becomes available.
   *
   * @returns {Promise<void>} A promise that resolves once a permit is acquired.
   *
   * @throws {Error} If there is an issue acquiring the permit.
   */
  public async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits-- // Grant the permit immediately
    } else {
      // Wait for a permit to become available
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
  }

  /**
   * Releases a permit, making it available for other tasks.
   * If there are waiting tasks in the queue, one of them will be resolved and allowed to acquire the permit.
   */
  public release(): boolean {
    if (this.queue.length > 0) {
      // deno-lint-ignore no-non-null-assertion
      const resolve = this.queue.shift()!
      resolve()
      return false // aún está activo
    } else {
      this.permits++
      return this.permits > 0
    }
  }
}
