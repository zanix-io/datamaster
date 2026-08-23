import { assert, assertEquals, assertRejects } from '@std/assert'
import { createLocalFilesystemObjectStorage } from 'storage/local-filesystem-object-storage.ts'

/**
 * `createLocalFilesystemObjectStorage` — the disk-backed `ObjectStorage` dev/fallback
 * implementation, ported from `@zanix/space`'s own `LocalFilesystemAssetStorage`. Exercises the
 * `ObjectStorage` contract directly (put/get round-trip, missing key, idempotent delete, nested
 * keys), against a real temp directory — no mocks needed, this adapter has no network dependency.
 */

Deno.test(
  'createLocalFilesystemObjectStorage: put/get round-trips real bytes and metadata',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      const bytes = new TextEncoder().encode('hello world')
      const stored = await storage.put('objects/a/data', bytes, { contentType: 'text/plain' })
      assertEquals(stored.key, 'objects/a/data')
      assertEquals(stored.contentType, 'text/plain')
      assertEquals(stored.size, bytes.byteLength)
      assert(stored.checksum, 'expected a real computed checksum')

      const found = await storage.get('objects/a/data')
      assert(found, 'expected the object to be found')
      assertEquals(found.object, stored)
      assertEquals(new Uint8Array(await new Response(found.stream).arrayBuffer()), bytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage: get returns undefined for a missing key',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      assertEquals(await storage.get('objects/does-not-exist'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage: exists reflects real presence, delete is idempotent',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      assertEquals(await storage.exists('objects/a/data'), false)
      await storage.put('objects/a/data', new Uint8Array([1, 2, 3]), { contentType: 'x' })
      assertEquals(await storage.exists('objects/a/data'), true)

      await storage.delete('objects/a/data')
      assertEquals(await storage.exists('objects/a/data'), false)
      // Deleting an already-gone key is a no-op, never an error.
      await storage.delete('objects/a/data')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage: a nested key creates its own directory tree',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      await storage.put('deeply/nested/key', new Uint8Array([9]), { contentType: 'x' })
      const found = await storage.get('deeply/nested/key')
      assert(found, 'expected the nested key to round-trip correctly')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

/**
 * Regression coverage for a confirmed path-traversal vulnerability: `key` used to be joined
 * straight onto `rootDir` (`join(rootDir, key)`) with no containment check, so a `key` that
 * escaped `rootDir` (`../`, or an absolute path overriding it entirely) let `put`/`get`/`delete`
 * touch disk outside the intended store. Fixed via `@zanix/helpers`'s `confinePath`.
 */
Deno.test(
  'createLocalFilesystemObjectStorage: put/get/delete/exists reject a traversing key',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      const bytes = new TextEncoder().encode('x')
      const traversingKeys = ['../../etc/passwd', 'a/../../x', '/etc/passwd']

      // Sequential per key, deliberately — a real Promise.all here would run every key's four
      // checks interleaved, which is fine functionally but harder to read than "one key, fully
      // checked, then the next".
      for (const key of traversingKeys) {
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.put(key, bytes, { contentType: 'text/plain' }))
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.get(key))
        // deno-lint-ignore no-await-in-loop
        await assertRejects(() => storage.delete(key))
        // `exists()` wraps everything in a catch-all that already treats any thrown error as
        // "not found" (true even before this fix, for e.g. a permission error) — so a rejected
        // key surfaces as `false` here, not a throw. Still safe: no traversal ever occurs either
        // way, only the shape of the negative result differs from the other three methods.
        // deno-lint-ignore no-await-in-loop
        assertEquals(await storage.exists(key), false)
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
