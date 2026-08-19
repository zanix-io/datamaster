import { assert, assertEquals } from '@std/assert'
import { createLocalFilesystemObjectStorage } from 'storage/local-filesystem-object-storage.ts'
import { ensureLocalObjectsSynced, resetLocalObjectsSyncState } from 'storage/sync-local-objects.ts'

/**
 * `ensureLocalObjectsSynced` — the lazy, memoized, once-per-process local->primary migration.
 * Ported from `@zanix/space`'s own `sync-local-assets-to-s3.test.ts` (same logic, generalized to
 * `ObjectStorage`). Uses a real `createLocalFilesystemObjectStorage` for the local side (the
 * migration walks a real directory tree) and a small in-memory fake for the "primary" side — no
 * real S3 needed to prove the migration logic itself.
 */

function createInMemoryObjectStorage() {
  const store = new Map<string, Uint8Array>()
  return {
    put(key: string, data: Uint8Array | ReadableStream<Uint8Array>, meta: { contentType: string }) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array()
      store.set(key, bytes)
      return Promise.resolve({
        key,
        contentType: meta.contentType,
        size: bytes.byteLength,
        checksum: 'x',
      })
    },
    get(key: string) {
      const bytes = store.get(key)
      if (!bytes) return Promise.resolve(undefined)
      return Promise.resolve({
        stream: new Response(new Uint8Array(bytes)).body as ReadableStream<Uint8Array>,
        object: { key, contentType: 'x', size: bytes.byteLength, checksum: 'x' },
      })
    },
    exists(key: string) {
      return Promise.resolve(store.has(key))
    },
    delete(key: string) {
      store.delete(key)
      return Promise.resolve()
    },
    has: (key: string) => store.has(key),
  }
}

Deno.test(
  'ensureLocalObjectsSynced migrates every object found only locally into the primary store',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir()
    try {
      const local = createLocalFilesystemObjectStorage(dir)
      await local.put('a', new TextEncoder().encode('one'), { contentType: 'text/plain' })
      await local.put('nested/b', new TextEncoder().encode('two'), { contentType: 'text/plain' })

      const primary = createInMemoryObjectStorage()
      await ensureLocalObjectsSynced(local, primary, dir)

      assert(primary.has('a'), 'expected the top-level key to have migrated')
      assert(primary.has('nested/b'), 'expected the nested key to have migrated with its full path')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'ensureLocalObjectsSynced skips a key the primary already has, never overwrites it',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir()
    try {
      const local = createLocalFilesystemObjectStorage(dir)
      await local.put('a', new TextEncoder().encode('local-version'), { contentType: 'text/plain' })

      const primary = createInMemoryObjectStorage()
      await primary.put('a', new TextEncoder().encode('primary-version'), {
        contentType: 'text/plain',
      })

      await ensureLocalObjectsSynced(local, primary, dir)

      const found = await primary.get('a')
      assert(found)
      const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer())
      assertEquals(bytes, new TextEncoder().encode('primary-version'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('ensureLocalObjectsSynced is a no-op for a rootDir that never existed', async () => {
  resetLocalObjectsSyncState()
  const local = createLocalFilesystemObjectStorage('/tmp/zanix-never-created-dir-xyz')
  const primary = createInMemoryObjectStorage()
  await ensureLocalObjectsSynced(local, primary, '/tmp/zanix-never-created-dir-xyz')
  // No throw is the assertion — nothing to migrate is a legitimate, silent outcome.
})

Deno.test(
  'ensureLocalObjectsSynced runs only once per process — memoized across calls',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir()
    try {
      const local = createLocalFilesystemObjectStorage(dir)
      await local.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

      let putCalls = 0
      const countingPrimary = createInMemoryObjectStorage()
      const wrapped = {
        ...countingPrimary,
        put: (
          key: string,
          data: Uint8Array | ReadableStream<Uint8Array>,
          meta: { contentType: string },
        ) => {
          putCalls++
          return countingPrimary.put(key, data, meta)
        },
      }

      await ensureLocalObjectsSynced(local, wrapped, dir)
      await ensureLocalObjectsSynced(local, wrapped, dir)
      await ensureLocalObjectsSynced(local, wrapped, dir)

      assertEquals(putCalls, 1, 'expected the real migration walk to have run exactly once')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'ensureLocalObjectsSynced resets its memo on failure, so the next call retries',
  async () => {
    resetLocalObjectsSyncState()
    const dir = await Deno.makeTempDir()
    try {
      const local = createLocalFilesystemObjectStorage(dir)
      await local.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

      let attempt = 0
      const flaky = {
        ...createInMemoryObjectStorage(),
        exists: () => {
          attempt++
          if (attempt === 1) return Promise.reject(new Error('transient failure'))
          return Promise.resolve(false)
        },
      }

      await assertRejectsOnce(() => ensureLocalObjectsSynced(local, flaky, dir))
      // Retried — the second call must NOT reuse the failed memo.
      await ensureLocalObjectsSynced(local, flaky, dir)
      assertEquals(attempt, 2)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

async function assertRejectsOnce(fn: () => Promise<unknown>): Promise<void> {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  assert(threw, 'expected the first call to reject')
}
