import { assertEquals } from '@std/assert'
import { BulkBuffer } from 'observability/bulk-buffer.ts'

Deno.test('BulkBuffer flushes immediately once maxSize is reached', async () => {
  const flushed: number[][] = []
  const buffer = new BulkBuffer<number>((items) => {
    flushed.push(items)
    return Promise.resolve()
  }, { maxSize: 2, flushIntervalMs: 100_000 })

  buffer.push(1)
  buffer.push(2)

  // The triggered flush is fire-and-forget (`void this.flush()`) — give it a tick to run.
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(flushed, [[1, 2]])
})

Deno.test('BulkBuffer flushes after flushIntervalMs even below maxSize', async () => {
  const flushed: number[][] = []
  const buffer = new BulkBuffer<number>((items) => {
    flushed.push(items)
    return Promise.resolve()
  }, { maxSize: 100, flushIntervalMs: 20 })

  buffer.push(1)
  assertEquals(flushed.length, 0)

  await new Promise((resolve) => setTimeout(resolve, 50))

  assertEquals(flushed, [[1]])
})

Deno.test('BulkBuffer.flush is a no-op when nothing is buffered', async () => {
  let flushCalls = 0
  const buffer = new BulkBuffer<number>(() => {
    flushCalls++
    return Promise.resolve()
  })

  await buffer.flush()

  assertEquals(flushCalls, 0)
})

Deno.test('BulkBuffer.flush lets a redundant concurrent call see nothing pending', async () => {
  let flushCalls = 0
  let resolveFirst: () => void = () => {}
  const buffer = new BulkBuffer<number>(() => {
    flushCalls++
    return new Promise((resolve) => {
      resolveFirst = () => resolve(undefined)
    })
  }, { maxSize: 100, flushIntervalMs: 100_000 })

  buffer.push(1)
  const firstFlush = buffer.flush()

  // The batch was already swapped out synchronously before `onFlush` was ever awaited — a second
  // call finds nothing pending and returns immediately instead of double-sending the same batch.
  await buffer.flush()
  assertEquals(flushCalls, 1)

  resolveFirst()
  await firstFlush
})

Deno.test('BulkBuffer starts a fresh batch after a flush', async () => {
  const flushed: number[][] = []
  const buffer = new BulkBuffer<number>((items) => {
    flushed.push(items)
    return Promise.resolve()
  }, { maxSize: 1, flushIntervalMs: 100_000 })

  buffer.push(1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  buffer.push(2)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(flushed, [[1], [2]])
})
