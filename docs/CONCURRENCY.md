# Concurrency

`Semaphore` and `LockManager` are general-purpose, **single-process, in-memory** concurrency
primitives — they don't coordinate across replicas or processes. `LockManager` is what backs the
cache provider's [`withLock`](./CACHE.md#withlock), but both are usable standalone.

## Semaphore

```ts
import { Semaphore } from 'jsr:@zanix/datamaster@[version]'

const semaphore = new Semaphore(2) // allow 2 concurrent operations

async function task() {
  await semaphore.acquire()
  try {
    // ... work ...
  } finally {
    semaphore.release()
  }
}
```

`acquire()` resolves immediately if a permit is available; otherwise it queues the caller (plain
FIFO — first to wait is first resumed) until `release()` frees one up. `release()` hands the freed
permit directly to the next queued waiter if there is one; only when the queue is empty does it
actually increment the available `permits` count.

## LockManager

```ts
import { LockManager } from 'jsr:@zanix/datamaster@[version]'

const lockManager = new LockManager(1) // 1 permit per key = exclusive lock (the default)

async function updateUserData(userId: string, data: unknown) {
  await lockManager.withLock(`user:${userId}`, async () => {
    // only one call for this exact key runs at a time; other keys run fully in parallel
    await saveToDatabase(data)
  })
}
```

`LockManager` keeps one `Semaphore` per key, created lazily the first time that key is locked, and
cleaned up automatically once nothing is left waiting on it — so locking an unbounded number of
distinct keys over time doesn't leak memory. `withLock` always releases the lock in a `finally`,
even if the callback throws.

### `withLock`

```ts
withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T>
```

Runs `fn` under an exclusive (or `permitsPerKey`-wide) lock for `key`, releasing it — and, once no
one else is waiting, forgetting the key entirely — when `fn` settles, whether it resolves or throws.

## See also

- [Cache](./CACHE.md) — `ZanixCacheCoreProvider.withLock`, built on this same `LockManager`.
