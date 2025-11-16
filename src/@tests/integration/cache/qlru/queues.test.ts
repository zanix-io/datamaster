import { assertEquals } from '@std/assert'
import { ZanixQLRUConnector } from 'modules/cache/providers/qlru/connector.ts'
import { LockManager } from 'utils/queues/lock-manager.ts'

Deno.test('QuickLRU: can support concurrency using lock manager', async () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 100 })

  const lockManager = new LockManager(1)

  const key = 'counter'

  const fn = () =>
    new Promise((resolve) => {
      let counter = cache.get(key) || 0
      counter++
      setTimeout(() => {
        cache.set(key, counter)
        resolve(true)
      })
    })

  // without lock
  await Promise.all([fn(), fn(), fn(), fn()])
  assertEquals(cache.get(key), 1)

  // with lock
  cache.clear()
  await Promise.all([
    lockManager.withLock(key, fn),
    lockManager.withLock(key, fn),
    lockManager.withLock(key, fn),
    lockManager.withLock(key, fn),
  ])

  assertEquals(cache.get(key), 4)
})
