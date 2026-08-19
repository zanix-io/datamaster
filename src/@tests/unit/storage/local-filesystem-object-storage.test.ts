import { assert, assertEquals } from '@std/assert'
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
