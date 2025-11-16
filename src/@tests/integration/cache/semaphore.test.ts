import { assert, assertEquals } from '@std/assert'
import { Semaphore } from 'utils/queues/semaphore.ts'

Deno.test('Semaphore: acquire decreases permits when available', async () => {
  const sem = new Semaphore(2)

  await sem.acquire()
  assertEquals(sem.permits, 1)

  await sem.acquire()
  assertEquals(sem.permits, 0)
})

Deno.test('Semaphore: acquire waits when no permits are available', async () => {
  const sem = new Semaphore(1)

  await sem.acquire() // consume the only permit

  let acquired = false

  // This acquire should block until a permit is released
  const p = sem.acquire().then(() => {
    acquired = true
  })

  // Wait a microtask tick to confirm it's still pending
  await Promise.resolve()
  assertEquals(acquired, false)

  // Releasing should unblock the waiting acquire call
  sem.release()
  await p

  assertEquals(acquired, true)
})

Deno.test('Semaphore: release wakes next waiting task', async () => {
  const sem = new Semaphore(1)

  await sem.acquire() // no permits left

  let task1 = false
  let task2 = false

  const p1 = sem.acquire().then(() => (task1 = true))
  const p2 = sem.acquire().then(() => (task2 = true))

  // At this point, both should be waiting
  await Promise.resolve()
  assertEquals(task1, false)
  assertEquals(task2, false)

  // First release should wake the first waiting task
  sem.release()
  await p1
  assertEquals(task1, true)
  assertEquals(task2, false)

  // Second release should wake the second waiting task
  sem.release()
  await p2
  assertEquals(task2, true)
})

Deno.test('Semaphore: release increases permits when no tasks are waiting', () => {
  const sem = new Semaphore(1)

  const idle = sem.release() // no queue, so permits should increment
  assertEquals(idle, true)
  assertEquals(sem.permits, 2)
})

Deno.test('Semaphore: respects FIFO order in queue', async () => {
  const sem = new Semaphore(1)

  await sem.acquire() // consume the permit

  const order: number[] = []

  const p1 = sem.acquire().then(() => order.push(1))
  const p2 = sem.acquire().then(() => order.push(2))
  const p3 = sem.acquire().then(() => order.push(3))

  // All should be queued
  await Promise.resolve()
  assertEquals(order.length, 0)

  // Release tasks in FIFO order
  sem.release()
  await p1

  sem.release()
  await p2

  sem.release()
  await p3

  assertEquals(order, [1, 2, 3])
})

Deno.test('Semaphore: multiple releases increase permits correctly', () => {
  const sem = new Semaphore(0)

  sem.release()
  assertEquals(sem.permits, 1)

  sem.release()
  assertEquals(sem.permits, 2)

  const idle = sem.release()
  assertEquals(idle, true)
  assertEquals(sem.permits, 3)
})

Deno.test('Semaphore: acquire returns immediately when a permit is available', async () => {
  const sem = new Semaphore(1)

  let acquired = false

  const p = sem.acquire().then(() => {
    acquired = true
  })

  await p
  assert(acquired)
  assertEquals(sem.permits, 0)
})
