// deno-lint-ignore-file no-explicit-any require-await
import { assert, assertEquals } from '@std/assert'
import { LockManager } from 'utils/queues/lock-manager.ts'

Deno.test('LockManager: enforces exclusive lock per key (default 1 permit)', async () => {
  const manager = new LockManager()

  let running = 0
  let maxRunning = 0

  const fn = async () => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await new Promise((resolve) => setTimeout(resolve, 10))
    running--
  }

  const p1 = manager.withLock('A', fn)
  const p2 = manager.withLock('A', fn)

  await Promise.all([p1, p2])

  // Only one should run at the same time for the same key
  assertEquals(maxRunning, 1)
})

Deno.test('LockManager: different keys run in parallel', async () => {
  const manager = new LockManager()

  let running = 0
  let maxRunning = 0

  const fn = async () => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await new Promise((resolve) => setTimeout(resolve, 10))
    running--
  }

  const p1 = manager.withLock('A', fn)
  const p2 = manager.withLock('B', fn)

  await Promise.all([p1, p2])

  // Different keys should execute concurrently
  assert(maxRunning >= 2)
})

Deno.test('LockManager: semaphore is removed from map when idle', async () => {
  const manager = new LockManager()

  assertEquals((manager as any).locks.size, 0)

  await manager.withLock('test', async () => {})

  // Once the lock is released and no pending tasks remain,
  // the semaphore should be removed
  assertEquals((manager as any).locks.size, 0)
})

Deno.test('LockManager: does not remove semaphore if tasks still pending', async () => {
  const manager = new LockManager()

  const a1 = manager.withLock('x', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  const a2 = manager.withLock('x', async () => {})

  // While tasks are executing, semaphore must be present
  assertEquals((manager as any).locks.size, 1)

  await Promise.all([a1, a2])

  // After both tasks finish, it should be cleaned up
  assertEquals((manager as any).locks.size, 0)
})

Deno.test('LockManager: reuses semaphore for the same key', async () => {
  const manager = new LockManager()

  await manager.withLock('k', async () => {})
  assertEquals((manager as any).locks.size, 0) // cleaned after release

  await manager.withLock('k', async () => {})
  assertEquals((manager as any).locks.size, 0) // cleaned again
})

Deno.test('LockManager: enforces FIFO order based on underlying semaphore', async () => {
  const manager = new LockManager()

  const order: number[] = []

  const fn1 = () =>
    manager.withLock('fifo', async () => {
      order.push(1)
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

  const fn2 = () =>
    manager.withLock('fifo', async () => {
      order.push(2)
    })

  const fn3 = () =>
    manager.withLock('fifo', async () => {
      order.push(3)
    })

  const p1 = fn1()
  const p2 = fn2()
  const p3 = fn3()

  await Promise.all([p1, p2, p3])

  // Tasks must execute in the same order they request the lock
  assertEquals(order, [1, 2, 3])
})

Deno.test('LockManager: releases lock even if the function throws', async () => {
  const manager = new LockManager()

  let secondExecuted = false

  const failingFn = async () => {
    throw new Error('fail')
  }

  const succeedingFn = async () => {
    secondExecuted = true
  }

  try {
    await manager.withLock('err', failingFn)
  } catch (_err) {
    // Expected error
  }

  // The next call must still run, meaning the lock was properly released
  await manager.withLock('err', succeedingFn)

  assert(secondExecuted)
})
