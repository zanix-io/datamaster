import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert'
import { generateRSAKeys } from '@zanix/helpers'
import { createLocalFilesystemObjectStorage } from 'storage/local-filesystem-object-storage.ts'

/**
 * `createLocalFilesystemObjectStorage` — the disk-backed `ObjectStorage` dev/fallback
 * implementation, ported from `@zanix/space`'s own `LocalFilesystemAssetStorage`. Exercises the
 * `ObjectStorage` contract directly (put/get round-trip, missing key, idempotent delete, nested
 * keys), against a real temp directory — no mocks needed, this adapter has no network dependency.
 *
 * The `options.encrypt` cases below mirror `s3-object-storage.test.ts`'s own encryption
 * assertions (real ciphertext on disk, a real round-trip, and the same `DATA_AES_KEY`/
 * `DATA_RSA_PUB`/`DATA_RSA_KEY` env vars) — this adapter reuses `encryptBytes`/`decryptBytes`
 * directly, so the same behavior is expected here.
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

Deno.test(
  'createLocalFilesystemObjectStorage: omitting options.encrypt writes the exact plaintext ' +
    'bytes to disk, unchanged from before the option existed',
  async () => {
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir)
      const bytes = new TextEncoder().encode('never encrypted')
      await storage.put('objects/plain/data', bytes, { contentType: 'text/plain' })

      const onDisk = await Deno.readFile(`${dir}/objects/plain/data`)
      assertEquals(onDisk, bytes, 'expected the raw file on disk to be the exact plaintext bytes')

      const found = await storage.get('objects/plain/data')
      assert(found, 'expected the object to be found')
      assertEquals(new Uint8Array(await new Response(found.stream).arrayBuffer()), bytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage with symmetric encryption stores ciphertext, never the ' +
    'plaintext bytes, on disk, and round-trips',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir, { encrypt: { type: 'symmetric' } })
      const plaintext = new TextEncoder().encode('sensitive voice memo bytes')
      await storage.put('objects/enc/data', plaintext, { contentType: 'audio/wav' })

      const onDisk = await Deno.readFile(`${dir}/objects/enc/data`)
      assertNotEquals(
        onDisk,
        plaintext,
        'expected the raw file on disk to be ciphertext, never the plaintext',
      )

      const fetched = await storage.get('objects/enc/data')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage with symmetric encryption enabled but no DATA_AES_KEY ' +
    'configured fails closed, never silently storing plaintext',
  async () => {
    Deno.env.delete('DATA_AES_KEY')
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir, { encrypt: { type: 'symmetric' } })
      await assertRejects(
        () => storage.put('objects/enc/data', new Uint8Array([1, 2, 3]), { contentType: 'x' }),
        Error,
        'DATA_AES_KEY',
      )
      assertEquals(await storage.exists('objects/enc/data'), false)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage with asymmetric encryption wraps a random per-object AES ' +
    'key with RSA and round-trips',
  async () => {
    const { publicKey, privateKey } = await generateRSAKeys()
    Deno.env.set('DATA_RSA_PUB', btoa(publicKey))
    Deno.env.set('DATA_RSA_KEY', btoa(privateKey))
    const dir = await Deno.makeTempDir()
    try {
      const storage = createLocalFilesystemObjectStorage(dir, { encrypt: { type: 'asymmetric' } })
      const plaintext = new TextEncoder().encode('sensitive video bytes')
      await storage.put('objects/enc/data', plaintext, { contentType: 'video/mp4' })

      const onDisk = await Deno.readFile(`${dir}/objects/enc/data`)
      assertNotEquals(onDisk, plaintext)

      const sidecar = JSON.parse(await Deno.readTextFile(`${dir}/objects/enc/data.meta.json`))
      assert(
        sidecar.encryption?.['wrapped-key'],
        'expected a wrapped per-object AES key in the sidecar metadata',
      )

      const fetched = await storage.get('objects/enc/data')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_RSA_PUB')
      Deno.env.delete('DATA_RSA_KEY')
    }
  },
)

Deno.test(
  'createLocalFilesystemObjectStorage.get: an encryption-enabled instance correctly reads a ' +
    'genuinely unencrypted object stored alongside real encrypted ones, without corrupting it',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const dir = await Deno.makeTempDir()
    try {
      const plain = createLocalFilesystemObjectStorage(dir)
      const rawPlaintext = new TextEncoder().encode('this one was never encrypted')
      await plain.put('objects/mixed/plain', rawPlaintext, { contentType: 'x' })

      const encrypted = createLocalFilesystemObjectStorage(dir, {
        encrypt: { type: 'symmetric' },
      })
      const fetchedPlain = await encrypted.get('objects/mixed/plain')
      assert(fetchedPlain, 'expected the unencrypted object to be found')
      assertEquals(
        new Uint8Array(await new Response(fetchedPlain.stream).arrayBuffer()),
        rawPlaintext,
        'expected the unencrypted object to be returned as-is, never run through decryptBytes',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)
