import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert'
import { generateRSAKeys } from '@zanix/helpers'
import { S3ObjectStorage } from 'storage/connector.ts'
import { S3Client } from '@aws-sdk/client-s3'

/**
 * Exercises `S3ObjectStorage`'s `put`/`get`/`delete`/`exists`/`isHealthy` against a stubbed
 * `S3Client.prototype.send` — no network, no real S3-compatible backend. Verifies both the S3
 * command shape sent for each operation AND the `ObjectStorage` contract (put/get round-trip,
 * undefined for a missing key, idempotent delete). A separate functional suite
 * (`src/@tests/functional/storage/s3-object-storage.test.ts`) exercises the same contract
 * against a real S3-compatible instance (SeaweedFS in CI/local dev).
 */

type SendHandler = (command: { constructor: { name: string }; input: unknown }) => unknown

console.error = () => {}

const originalSend = S3Client.prototype.send

function stubSend(handler: SendHandler): void {
  // deno-lint-ignore no-explicit-any
  S3Client.prototype.send = handler as any
}

function restoreSend(): void {
  S3Client.prototype.send = originalSend
}

function notFoundError(name: string): Error {
  const error = new Error(`${name} not found`)
  error.name = name
  return error
}

Deno.test(
  'S3ObjectStorage.put sends a PutObjectCommand with the computed checksum and content-type',
  async () => {
    let sentInput: { constructor: { name: string }; input: unknown } | undefined
    stubSend((command) => {
      sentInput = command
      return Promise.resolve({})
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      const bytes = new TextEncoder().encode('hello world')
      const result = await storage.put('objects/a/data', bytes, {
        contentType: 'text/plain',
      })

      assertEquals(sentInput?.constructor.name, 'PutObjectCommand')
      const input = sentInput?.input as {
        Bucket: string
        Key: string
        Body: Uint8Array
        ContentType: string
        Metadata: Record<string, string>
      }
      assertEquals(input.Bucket, 'test')
      assertEquals(input.Key, 'objects/a/data')
      assertEquals(input.ContentType, 'text/plain')
      assertEquals(input.Body, bytes)
      assert(input.Metadata.checksum, 'expected a checksum in the object metadata')

      assertEquals(result.key, 'objects/a/data')
      assertEquals(result.contentType, 'text/plain')
      assertEquals(result.size, bytes.byteLength)
      assertEquals(result.checksum, input.Metadata.checksum)
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.get returns the stored bytes and metadata for an existing key',
  async () => {
    const bytes = new TextEncoder().encode('payload')
    stubSend((command) => {
      if (command.constructor.name === 'GetObjectCommand') {
        return Promise.resolve({
          ContentType: 'text/plain',
          Metadata: { checksum: 'abc123' },
          Body: { transformToByteArray: () => Promise.resolve(bytes) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      const result = await storage.get('objects/a/data')
      assert(result, 'expected the object to be found')
      assertEquals(result.object.checksum, 'abc123')
      assertEquals(result.object.contentType, 'text/plain')
      const streamed = new Uint8Array(await new Response(result.stream).arrayBuffer())
      assertEquals(streamed, bytes)
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.get returns undefined for a missing key (NoSuchKey)',
  async () => {
    stubSend(() => Promise.reject(notFoundError('NoSuchKey')))
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      const result = await storage.get('objects/does-not-exist/data')
      assertEquals(result, undefined)
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.get propagates a real connectivity error, never treats it as missing',
  async () => {
    stubSend(() => Promise.reject(new Error('ECONNREFUSED')))
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      await assertRejects(() => storage.get('objects/a/data'), Error, 'ECONNREFUSED')
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.exists returns true when HeadObjectCommand succeeds',
  async () => {
    stubSend((command) => {
      assertEquals(command.constructor.name, 'HeadObjectCommand')
      return Promise.resolve({})
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      assertEquals(await storage.exists('objects/a/data'), true)
    } finally {
      restoreSend()
    }
  },
)

Deno.test('S3ObjectStorage.exists returns false for a missing key (NotFound)', async () => {
  stubSend(() => Promise.reject(notFoundError('NotFound')))
  try {
    const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
    assertEquals(await storage.exists('objects/does-not-exist/data'), false)
  } finally {
    restoreSend()
  }
})

Deno.test(
  'S3ObjectStorage.delete sends a DeleteObjectCommand for the given key',
  async () => {
    let sentInput: unknown
    stubSend((command) => {
      assertEquals(command.constructor.name, 'DeleteObjectCommand')
      sentInput = command.input
      return Promise.resolve({})
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      await storage.delete('objects/a/data')
      assertEquals((sentInput as { Key: string }).Key, 'objects/a/data')
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.isHealthy returns true when HeadBucketCommand succeeds',
  async () => {
    stubSend((command) => {
      assertEquals(command.constructor.name, 'HeadBucketCommand')
      return Promise.resolve({})
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      assertEquals(await storage.isHealthy(), true)
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage.isHealthy returns false when the bucket is unreachable',
  async () => {
    stubSend(() => Promise.reject(new Error('ECONNREFUSED')))
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      assertEquals(await storage.isHealthy(), false)
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage with symmetric encryption stores ciphertext, never the plaintext bytes, and round-trips',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as {
          Key: string
          Body: Uint8Array
          ContentType: string
          Metadata: Record<string, string>
        }
        store.set(input.Key, input)
        return Promise.resolve({})
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric' },
      })
      const plaintext = new TextEncoder().encode('sensitive voice memo bytes')
      await storage.put('objects/b/data', plaintext, { contentType: 'audio/wav' })

      const stored = store.get('objects/b/data')
      assert(stored, 'expected the object to have been stored')
      assertNotEquals(
        stored.Body,
        plaintext,
        'expected the stored bytes to be ciphertext, never the plaintext',
      )

      const fetched = await storage.get('objects/b/data')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)

Deno.test(
  'S3ObjectStorage with symmetric encryption enabled but no DATA_AES_KEY configured fails closed',
  async () => {
    Deno.env.delete('DATA_AES_KEY')
    stubSend(() => {
      throw new Error('PutObjectCommand should never be sent when encryption fails')
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric' },
      })
      await assertRejects(
        () => storage.put('objects/c/data', new Uint8Array([1, 2, 3]), { contentType: 'x' }),
        Error,
        'DATA_AES_KEY',
      )
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage with asymmetric encryption wraps a random per-object AES key with RSA and round-trips',
  async () => {
    const { publicKey, privateKey } = await generateRSAKeys()
    Deno.env.set('DATA_RSA_PUB', btoa(publicKey))
    Deno.env.set('DATA_RSA_KEY', btoa(privateKey))
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as {
          Key: string
          Body: Uint8Array
          ContentType: string
          Metadata: Record<string, string>
        }
        store.set(input.Key, input)
        return Promise.resolve({})
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'asymmetric' },
      })
      const plaintext = new TextEncoder().encode('sensitive video bytes')
      await storage.put('objects/d/data', plaintext, { contentType: 'video/mp4' })

      const stored = store.get('objects/d/data')
      assert(stored, 'expected the object to have been stored')
      assertNotEquals(stored.Body, plaintext)
      assert(stored.Metadata['wrapped-key'], 'expected a wrapped per-object AES key in metadata')

      const fetched = await storage.get('objects/d/data')
      assert(fetched, 'expected the object to be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(roundTripped, plaintext)
    } finally {
      restoreSend()
      Deno.env.delete('DATA_RSA_PUB')
      Deno.env.delete('DATA_RSA_KEY')
    }
  },
)

// --- Key rotation: an object's own recorded encryption version, not whichever version is
// currently "active" for new writes, must always govern its own decryption. --------------------

Deno.test(
  'S3ObjectStorage with a versioned symmetric key encrypts under DATA_AES_KEY_V1 and ' +
    'records that version in the object metadata',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'a-versioned-key')
    const store = new Map<string, { Metadata: Record<string, string> }>()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as { Key: string; Metadata: Record<string, string> }
        store.set(input.Key, { Metadata: input.Metadata })
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      await storage.put('objects/e/data', new Uint8Array([1, 2, 3]), { contentType: 'x' })

      const stored = store.get('objects/e/data')
      assert(stored, 'expected the object to have been stored')
      assertEquals(stored.Metadata['encryption-version'], 'v1')
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

Deno.test(
  'S3ObjectStorage: rotating the active key version never breaks decrypting an object ' +
    'encrypted under the OLD version',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'the-v0-key')
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as {
          Key: string
          Body: Uint8Array
          ContentType: string
          Metadata: Record<string, string>
        }
        store.set(input.Key, input)
        return Promise.resolve({})
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      // Written BEFORE rotation, under the unsuffixed (v0) key.
      const preRotation = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric' },
      })
      const plaintext = new TextEncoder().encode('written before the key was rotated')
      await preRotation.put('objects/f/data', plaintext, { contentType: 'text/plain' })

      // Simulates the rotation: a NEW connector instance, configured to encrypt future writes
      // under v1 — but reading the SAME pre-rotation object.
      const postRotation = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const fetched = await postRotation.get('objects/f/data')
      assert(fetched, 'expected the pre-rotation object to still be found')
      const roundTripped = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(
        roundTripped,
        plaintext,
        "expected decryption to use the object's OWN recorded v0 key, not the now-active v1 one",
      )
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY')
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

Deno.test(
  'S3ObjectStorage: full V1 -> V2 rotation — an object written under V1 keeps reading ' +
    'correctly after the active version moves to V2, and a NEW object written after rotation ' +
    'uses V2 and reads back correctly too',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    Deno.env.set('DATA_AES_KEY_V2', 'the-v2-key')
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as {
          Key: string
          Body: Uint8Array
          ContentType: string
          Metadata: Record<string, string>
        }
        store.set(input.Key, input)
        return Promise.resolve({})
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      // Write under V1 (the active version at the time).
      const v1Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const oldPlaintext = new TextEncoder().encode('written while V1 was active')
      await v1Storage.put('objects/g/old', oldPlaintext, { contentType: 'text/plain' })

      // Rotate: active version moves to V2 (a new connector instance, matching how a real
      // deployment would reconfigure and restart with the new active version).
      const v2Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v2' },
      })

      // The OLD object still reads correctly post-rotation, under its own recorded V1 key.
      const oldFetched = await v2Storage.get('objects/g/old')
      assert(oldFetched, 'expected the pre-rotation V1 object to still be found')
      assertEquals(
        new Uint8Array(await new Response(oldFetched.stream).arrayBuffer()),
        oldPlaintext,
      )

      // A NEW object written post-rotation uses V2 — verify by inspecting its recorded metadata.
      const newPlaintext = new TextEncoder().encode('written after rotating to V2')
      await v2Storage.put('objects/g/new', newPlaintext, { contentType: 'text/plain' })
      const newStored = store.get('objects/g/new')
      assert(newStored, 'expected the new object to have been stored')
      assertEquals(newStored.Metadata['encryption-version'], 'v2')

      // ...and reads back correctly.
      const newFetched = await v2Storage.get('objects/g/new')
      assert(newFetched, 'expected the new V2 object to be found')
      assertEquals(
        new Uint8Array(await new Response(newFetched.stream).arrayBuffer()),
        newPlaintext,
      )
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY_V1')
      Deno.env.delete('DATA_AES_KEY_V2')
    }
  },
)

Deno.test(
  'S3ObjectStorage: an object declaring an encryption version whose key is unavailable ' +
    'fails clearly — it is never silently decrypted with the CURRENT active key instead',
  async () => {
    // Only V2 is configured — the object below claims V5, a version that was never rotated to.
    Deno.env.set('DATA_AES_KEY_V2', 'the-v2-key')
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      // Simulate an object that was written under a version whose key has since been removed
      // from the environment (e.g. cleaned up too early during a rotation).
      store.set('objects/h/orphaned', {
        Body: new TextEncoder().encode('irrelevant — decryption must fail before using this'),
        ContentType: 'text/plain',
        Metadata: { checksum: 'irrelevant', 'encryption-version': 'v5' },
      })

      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v2' },
      })
      await assertRejects(
        () => storage.get('objects/h/orphaned'),
        Error,
        'DATA_AES_KEY_V5',
      )
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY_V2')
    }
  },
)

Deno.test(
  'S3ObjectStorage.get: an encryption-enabled instance correctly reads BOTH a real ' +
    'encrypted object AND a genuinely unencrypted object stored alongside it, without corrupting ' +
    'the plaintext one by attempting to decrypt it',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'a-test-symmetric-key-value')
    const store = new Map<
      string,
      { Body: Uint8Array; ContentType: string; Metadata: Record<string, string> }
    >()
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const input = command.input as {
          Key: string
          Body: Uint8Array
          ContentType: string
          Metadata: Record<string, string>
        }
        store.set(input.Key, input)
        return Promise.resolve({})
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const input = command.input as { Key: string }
        const stored = store.get(input.Key)
        if (!stored) throw notFoundError('NoSuchKey')
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const encrypted = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric' },
      })
      const encryptedPlaintext = new TextEncoder().encode('this one is really encrypted')
      await encrypted.put('objects/mixed/encrypted', encryptedPlaintext, { contentType: 'x' })

      // Simulates an object written by a DIFFERENT instance with encryption off (or before
      // encryption was ever enabled) — no `encryption-version` metadata at all, sitting in the
      // same bucket as the real ciphertext object above.
      const rawPlaintext = new TextEncoder().encode('this one was never encrypted')
      store.set('objects/mixed/plain', {
        Body: rawPlaintext,
        ContentType: 'x',
        Metadata: { checksum: 'irrelevant-recomputed' },
      })

      const fetchedEncrypted = await encrypted.get('objects/mixed/encrypted')
      assert(fetchedEncrypted, 'expected the encrypted object to be found')
      assertEquals(
        new Uint8Array(await new Response(fetchedEncrypted.stream).arrayBuffer()),
        encryptedPlaintext,
      )

      const fetchedPlain = await encrypted.get('objects/mixed/plain')
      assert(fetchedPlain, 'expected the unencrypted object to be found')
      assertEquals(
        new Uint8Array(await new Response(fetchedPlain.stream).arrayBuffer()),
        rawPlaintext,
        'expected the unencrypted object to be returned as-is, never run through decryptBytes',
      )
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)

// --- S3_ENCRYPT/S3_ENCRYPT_VERSION: the only way to enable encryption on the
// connector instance the standard @Connector/DI boot path constructs (it never receives custom
// constructor arguments). --------------------------------------------------------------------

Deno.test(
  'S3ObjectStorage: S3_ENCRYPT=symmetric enables encryption with no constructor option',
  async () => {
    Deno.env.set('DATA_AES_KEY', 'env-driven-key')
    Deno.env.set('S3_ENCRYPT', 'symmetric')
    let sentBody: Uint8Array | undefined
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        sentBody = (command.input as { Body: Uint8Array }).Body
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      // No `encrypt` option at all — matches exactly how `core.ts`'s `_S3CoreObjectStorage`
      // is constructed by the real DI boot path.
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      const plaintext = new TextEncoder().encode('should be encrypted via env var alone')
      await storage.put('objects/i/data', plaintext, { contentType: 'text/plain' })
      assert(sentBody, 'expected a PutObjectCommand to have been sent')
      assertNotEquals(sentBody, plaintext, 'expected the stored bytes to be ciphertext')
    } finally {
      restoreSend()
      Deno.env.delete('DATA_AES_KEY')
      Deno.env.delete('S3_ENCRYPT')
    }
  },
)

Deno.test(
  'S3ObjectStorage: an explicit encrypt option always wins over S3_ENCRYPT',
  async () => {
    // The env var says "symmetric"; the explicit option below says "asymmetric" instead — proven
    // by requiring DATA_RSA_PUB (which a symmetric encryption would never look for) and NOT
    // setting DATA_AES_KEY at all (which a symmetric encryption would have needed).
    Deno.env.set('S3_ENCRYPT', 'symmetric')
    const { publicKey } = await generateRSAKeys()
    Deno.env.set('DATA_RSA_PUB', btoa(publicKey))
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') return Promise.resolve({})
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'asymmetric' },
      })
      const result = await storage.put('objects/j/data', new Uint8Array([1, 2, 3]), {
        contentType: 'x',
      })
      assert(result, 'expected the asymmetric-encrypted put to succeed using the explicit option')
    } finally {
      restoreSend()
      Deno.env.delete('S3_ENCRYPT')
      Deno.env.delete('DATA_RSA_PUB')
    }
  },
)

Deno.test(
  'S3ObjectStorage: an invalid S3_ENCRYPT value leaves encryption off, never throws',
  async () => {
    Deno.env.set('S3_ENCRYPT', 'not-a-real-type')
    let sentBody: Uint8Array | undefined
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        sentBody = (command.input as { Body: Uint8Array }).Body
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
      const plaintext = new TextEncoder().encode('stored as plaintext, encryption never activated')
      await storage.put('objects/k/data', plaintext, { contentType: 'text/plain' })
      assertEquals(sentBody, plaintext)
    } finally {
      restoreSend()
      Deno.env.delete('S3_ENCRYPT')
    }
  },
)

Deno.test(
  'S3ObjectStorage: encrypt: false explicitly overrides S3_ENCRYPT, forcing this ' +
    'ONE instance unencrypted even though the env var enables it process-wide — the exact ' +
    'real-world need: a diagnostic/comparison connector that must see genuinely raw bytes',
  async () => {
    Deno.env.set('S3_ENCRYPT', 'symmetric')
    Deno.env.set('DATA_AES_KEY', 'irrelevant-should-never-be-read')
    let sentBody: Uint8Array | undefined
    stubSend((command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        sentBody = (command.input as { Body: Uint8Array }).Body
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    })
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: false,
      })
      const plaintext = new TextEncoder().encode('must stay plaintext despite the env var')
      await storage.put('objects/l/data', plaintext, { contentType: 'text/plain' })
      assertEquals(
        sentBody,
        plaintext,
        'expected encrypt:false to win over S3_ENCRYPT — this is the real bug a real ' +
          'end-to-end test surfaced: a "raw" comparison connector with no encrypt option at all ' +
          'was silently inheriting the env var, masking whether encryption actually happened',
      )
    } finally {
      restoreSend()
      Deno.env.delete('S3_ENCRYPT')
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)

// --- connectorOptions: the resolved, structured-cloneable options rotation.ts's useWorker
// reconstructs a worker-thread instance from — must round-trip to an EQUIVALENT instance. -------

Deno.test(
  'S3ObjectStorage.connectorOptions round-trips to a new instance with identical ' +
    'behavior, regardless of the env vars at reconstruction time',
  () => {
    const original = new S3ObjectStorage({
      autoInitialize: false,
      endpoint: 'http://original-endpoint:8333',
      bucket: 'original-bucket',
      accessKeyId: 'original-key',
      secretAccessKey: 'original-secret',
      encrypt: { type: 'symmetric', version: 'v3' },
    })
    const options = original.connectorOptions
    assertEquals(options.endpoint, 'http://original-endpoint:8333')
    assertEquals(options.bucket, 'original-bucket')
    assertEquals(options.accessKeyId, 'original-key')
    assertEquals(options.secretAccessKey, 'original-secret')
    assertEquals(options.encrypt, { type: 'symmetric', version: 'v3' })

    // A DIFFERENT env var setup at reconstruction time must NOT change the reconstructed
    // instance's behavior — every value is already resolved, not re-read from the environment.
    Deno.env.set('S3_ENDPOINT', 'http://should-be-ignored:9999')
    Deno.env.set('S3_BUCKET', 'should-be-ignored-bucket')
    try {
      const reconstructed = new S3ObjectStorage({ autoInitialize: false, ...options })
      assertEquals(reconstructed.connectorOptions, options)
      assertEquals(reconstructed.encryptSettings, { type: 'symmetric', version: 'v3' })
    } finally {
      Deno.env.delete('S3_ENDPOINT')
      Deno.env.delete('S3_BUCKET')
    }
  },
)

Deno.test(
  'S3ObjectStorage.connectorOptions reports encrypt: false (never undefined) when ' +
    'encryption is off, so a worker reconstruction never accidentally re-enables it via env var',
  () => {
    Deno.env.set('S3_ENCRYPT', 'symmetric')
    Deno.env.set('DATA_AES_KEY', 'irrelevant-should-never-be-read')
    try {
      const original = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: false,
      })
      assertEquals(original.connectorOptions.encrypt, false)

      const reconstructed = new S3ObjectStorage({
        autoInitialize: false,
        ...original.connectorOptions,
      })
      assertEquals(
        reconstructed.encryptSettings,
        undefined,
        'expected the reconstructed instance to stay unencrypted despite S3_ENCRYPT ' +
          'still being set in the environment',
      )
    } finally {
      Deno.env.delete('S3_ENCRYPT')
      Deno.env.delete('DATA_AES_KEY')
    }
  },
)
