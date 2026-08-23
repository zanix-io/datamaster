// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from '@std/assert'
import { generateRSAKeys } from '@zanix/helpers'
import { ProgramModule } from '@zanix/server'
import { WorkerManager } from '@zanix/workers'
import { S3ObjectStorage } from 'storage/connector.ts'
import { checkEncryptionRotationStatus, rotateEncryptionKeys } from 'storage/rotation.ts'
import { S3Client } from '@aws-sdk/client-s3'

console.error = () => {}

/**
 * `checkEncryptionRotationStatus()`/`rotateEncryptionKeys()` (`storage/rotation.ts`) against a
 * stubbed `S3Client.prototype.send` backed by an in-memory fake bucket — no network, no real
 * S3-compatible backend (see `src/@tests/functional/storage/` for the real-infrastructure
 * counterpart).
 * Exercises pagination, dry-run, already-active/old-version/unencrypted handling, per-key failure
 * collection, the concurrent-overwrite checksum re-check, and the `useWorker` dispatch path.
 */

interface FakeObject {
  Body: Uint8Array
  ContentType: string
  Metadata: Record<string, string>
}

const originalSend = S3Client.prototype.send

function notFoundError(name: string): Error {
  const error = new Error(`${name} not found`)
  error.name = name
  return error
}

/** An in-memory fake bucket backing `S3Client.prototype.send` — handles every command
 * `rotation-core.ts`'s walk actually issues (`ListObjectsV2Command`/`HeadObjectCommand`/
 * `GetObjectCommand`/`PutObjectCommand`), real enough for real `S3ObjectStorage` instances
 * (including real encryption) to round-trip through it. */
function installFakeBucket(store: Map<string, FakeObject>): () => void {
  S3Client.prototype.send = ((command: { constructor: { name: string }; input: any }) => {
    switch (command.constructor.name) {
      case 'ListObjectsV2Command': {
        const { Prefix, ContinuationToken, MaxKeys } = command.input
        const allKeys = [...store.keys()]
          .filter((key) => !Prefix || key.startsWith(Prefix))
          .sort()
        const start = ContinuationToken ? Number(ContinuationToken) : 0
        const maxKeys = MaxKeys ?? 1000
        const page = allKeys.slice(start, start + maxKeys)
        const truncated = start + maxKeys < allKeys.length
        return Promise.resolve({
          Contents: page.map((Key) => ({ Key })),
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(start + maxKeys) : undefined,
        })
      }
      case 'HeadObjectCommand': {
        const stored = store.get(command.input.Key)
        if (!stored) return Promise.reject(notFoundError('NotFound'))
        return Promise.resolve({ Metadata: stored.Metadata })
      }
      case 'GetObjectCommand': {
        const stored = store.get(command.input.Key)
        if (!stored) return Promise.reject(notFoundError('NoSuchKey'))
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      case 'PutObjectCommand': {
        const { Key, Body, ContentType, Metadata } = command.input
        store.set(Key, { Body, ContentType, Metadata })
        return Promise.resolve({})
      }
      case 'DeleteObjectCommand': {
        store.delete(command.input.Key)
        return Promise.resolve({})
      }
      default:
        throw new Error(`unexpected command: ${command.constructor.name}`)
    }
  }) as any
  return () => {
    S3Client.prototype.send = originalSend
  }
}

// --- checkEncryptionRotationStatus / rotateEncryptionKeys guard rail -----------------------------

Deno.test(
  'checkEncryptionRotationStatus throws when the storage instance has no encrypt configured',
  async () => {
    const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
    await assertRejects(() => checkEncryptionRotationStatus(storage), Error, 'encryption disabled')
  },
)

Deno.test(
  'rotateEncryptionKeys throws when the storage instance has no encrypt configured',
  async () => {
    const storage = new S3ObjectStorage({ autoInitialize: false, bucket: 'test' })
    await assertRejects(() => rotateEncryptionKeys(storage), Error, 'encryption disabled')
  },
)

// --- checkEncryptionRotationStatus: real read-only classification --------------------------------

Deno.test(
  'checkEncryptionRotationStatus reports active/old/unencrypted counts and safeToRetireOldKeys',
  async () => {
    const store = new Map<string, FakeObject>([
      ['a', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v2' } }],
      ['b', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v2' } }],
      ['c', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v1' } }],
      ['d', { Body: new Uint8Array(), ContentType: 'x', Metadata: {} }],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v2' },
      })
      const status = await checkEncryptionRotationStatus(storage)
      assertEquals(status.activeVersion, 'v2')
      assertEquals(status.totalObjects, 4)
      assertEquals(status.onActiveVersion, 2)
      assertEquals(status.versionsStillInUse, ['v1'])
      assertEquals(status.unencrypted, 1)
      assertEquals(status.safeToRetireOldKeys, false)
    } finally {
      restore()
    }
  },
)

Deno.test(
  'checkEncryptionRotationStatus: safeToRetireOldKeys is true once every object is on the ' +
    'active version',
  async () => {
    const store = new Map<string, FakeObject>([
      ['a', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v2' } }],
      ['b', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v2' } }],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v2' },
      })
      const status = await checkEncryptionRotationStatus(storage)
      assertEquals(status.safeToRetireOldKeys, true)
    } finally {
      restore()
    }
  },
)

// --- pagination ------------------------------------------------------------------------------

Deno.test(
  'checkEncryptionRotationStatus walks every page — not truncated at the first page',
  async () => {
    const store = new Map<string, FakeObject>()
    for (let i = 0; i < 7; i++) {
      store.set(`key-${i}`, {
        Body: new Uint8Array(),
        ContentType: 'x',
        Metadata: { 'encryption-version': 'v1' },
      })
    }
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const status = await checkEncryptionRotationStatus(storage, { maxKeysPerPage: 2 })
      assertEquals(status.totalObjects, 7, 'expected all 7 keys across 4 pages of maxKeysPerPage=2')
      assertEquals(status.onActiveVersion, 7)
    } finally {
      restore()
    }
  },
)

Deno.test(
  'rotateEncryptionKeys walks every page and migrates every eligible key across pages',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>()
    for (let i = 0; i < 5; i++) {
      store.set(`key-${i}`, {
        Body: new TextEncoder().encode('irrelevant'),
        ContentType: 'x',
        Metadata: {},
      })
    }
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage, { maxKeysPerPage: 2 })
      assertEquals(result.scanned, 5)
      assertEquals(result.migrated, 5)
      assertEquals(result.failed, [])
      for (let i = 0; i < 5; i++) {
        assertEquals(store.get(`key-${i}`)?.Metadata['encryption-version'], 'v1')
      }
    } finally {
      restore()
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- dry-run ---------------------------------------------------------------------------------

Deno.test(
  'rotateEncryptionKeys dryRun reports what would migrate without writing anything',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>([
      ['a', { Body: new TextEncoder().encode('plain'), ContentType: 'x', Metadata: {} }],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage, { dryRun: true })
      assertEquals(result.migrated, 1)
      assertEquals(
        store.get('a')?.Metadata['encryption-version'],
        undefined,
        'expected dryRun to never actually write — the object stays exactly as it was',
      )
    } finally {
      restore()
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- already-active version: skipped, and never even read ------------------------------------

Deno.test(
  'rotateEncryptionKeys skips an object already on the active version without ever reading it',
  async () => {
    const store = new Map<string, FakeObject>([
      ['a', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v1' } }],
    ])
    S3Client.prototype.send = ((command: { constructor: { name: string }; input: any }) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return Promise.resolve({ Contents: [{ Key: 'a' }], IsTruncated: false })
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        const stored = store.get('a')
        return Promise.resolve({ Metadata: stored?.Metadata ?? {} })
      }
      if (command.constructor.name === 'GetObjectCommand') {
        throw new Error(
          'GetObjectCommand should never be sent for an already-active-version object',
        )
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    }) as any
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage)
      assertEquals(result.scanned, 1)
      assertEquals(result.migrated, 0)
      assertEquals(result.skipped, 1)
    } finally {
      S3Client.prototype.send = originalSend
    }
  },
)

// --- old version: real bytes, real re-encryption round trip ----------------------------------

Deno.test(
  'rotateEncryptionKeys re-encrypts a real object from an old version to the active one, and ' +
    'it decrypts correctly afterwards',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    Deno.env.set('DATA_AES_KEY_V2', 'the-v2-key')
    const store = new Map<string, FakeObject>()
    const restore = installFakeBucket(store)
    try {
      // Written for real, under v1 (the active version at the time).
      const v1Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const plaintext = new TextEncoder().encode('rotate me to v2')
      await v1Storage.put('objects/rot/a', plaintext, { contentType: 'text/plain' })
      assertEquals(store.get('objects/rot/a')?.Metadata['encryption-version'], 'v1')
      const ciphertextBeforeRotation = store.get('objects/rot/a')?.Body

      // Rotate: active version is now v2.
      const v2Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v2' },
      })
      const result = await rotateEncryptionKeys(v2Storage)
      assertEquals(result.migrated, 1)
      assertEquals(result.skipped, 0)
      assertEquals(result.failed, [])

      assertEquals(store.get('objects/rot/a')?.Metadata['encryption-version'], 'v2')
      assert(
        store.get('objects/rot/a')?.Body !== ciphertextBeforeRotation,
        'expected the ciphertext to have actually changed after re-encrypting under v2',
      )

      const fetched = await v2Storage.get('objects/rot/a')
      assert(fetched, 'expected the migrated object to still be readable')
      assertEquals(new Uint8Array(await new Response(fetched.stream).arrayBuffer()), plaintext)
    } finally {
      restore()
      Deno.env.delete('DATA_AES_KEY_V1')
      Deno.env.delete('DATA_AES_KEY_V2')
    }
  },
)

// --- unencrypted objects: encrypted for the first time by the rotation -----------------------

Deno.test(
  'rotateEncryptionKeys encrypts a genuinely unencrypted object under the active version',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const plaintext = new TextEncoder().encode('never encrypted before')
    const store = new Map<string, FakeObject>([
      [
        'objects/plain/a',
        { Body: plaintext, ContentType: 'text/plain', Metadata: { checksum: 'irrelevant' } },
      ],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage)
      assertEquals(result.migrated, 1)
      assertEquals(store.get('objects/plain/a')?.Metadata['encryption-version'], 'v1')
      assert(
        store.get('objects/plain/a')?.Body !== plaintext,
        'expected the object to now be stored as ciphertext',
      )

      const fetched = await storage.get('objects/plain/a')
      assert(fetched, 'expected the now-encrypted object to still be found')
      assertEquals(new Uint8Array(await new Response(fetched.stream).arrayBuffer()), plaintext)
    } finally {
      restore()
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- per-key failures: collected, never abort the whole run -----------------------------------

Deno.test(
  'rotateEncryptionKeys collects a per-key failure and keeps migrating the rest',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>([
      ['good-a', { Body: new TextEncoder().encode('a'), ContentType: 'x', Metadata: {} }],
      ['bad', { Body: new TextEncoder().encode('b'), ContentType: 'x', Metadata: {} }],
      ['good-b', { Body: new TextEncoder().encode('c'), ContentType: 'x', Metadata: {} }],
    ])
    S3Client.prototype.send = ((command: { constructor: { name: string }; input: any }) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return Promise.resolve({
          Contents: [...store.keys()].sort().map((Key) => ({ Key })),
          IsTruncated: false,
        })
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        const stored = store.get(command.input.Key)
        if (!stored) return Promise.reject(notFoundError('NotFound'))
        return Promise.resolve({ Metadata: stored.Metadata })
      }
      if (command.constructor.name === 'GetObjectCommand') {
        if (command.input.Key === 'bad') return Promise.reject(new Error('ECONNREFUSED'))
        const stored = store.get(command.input.Key)
        if (!stored) return Promise.reject(notFoundError('NoSuchKey'))
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      if (command.constructor.name === 'PutObjectCommand') {
        const { Key, Body, ContentType, Metadata } = command.input
        store.set(Key, { Body, ContentType, Metadata })
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    }) as any
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage)
      assertEquals(result.scanned, 3)
      assertEquals(result.migrated, 2)
      assertEquals(result.failed.length, 1)
      assertEquals(result.failed[0].key, 'bad')
      assert(result.failed[0].error.includes('ECONNREFUSED'))
      assertEquals(store.get('good-a')?.Metadata['encryption-version'], 'v1')
      assertEquals(store.get('good-b')?.Metadata['encryption-version'], 'v1')
    } finally {
      S3Client.prototype.send = originalSend
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- concurrent overwrite: the checksum re-check skips rather than clobbers -------------------

Deno.test(
  'rotateEncryptionKeys skips a key that changed concurrently, never overwriting the newer write',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>([
      [
        'objects/race/a',
        {
          Body: new TextEncoder().encode('original'),
          ContentType: 'x',
          Metadata: { checksum: 'checksum-v1' },
        },
      ],
    ])
    let headCalls = 0
    const puts: unknown[] = []
    S3Client.prototype.send = ((command: { constructor: { name: string }; input: any }) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return Promise.resolve({ Contents: [{ Key: 'objects/race/a' }], IsTruncated: false })
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        headCalls++
        // The SECOND HeadObjectCommand (the re-check right before writing) simulates a
        // concurrent application write landing in between: a different checksum than the
        // first read saw.
        const checksum = headCalls === 1 ? 'checksum-v1' : 'checksum-v2-written-concurrently'
        return Promise.resolve({ Metadata: { checksum } })
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const stored = store.get(command.input.Key)
        if (!stored) return Promise.reject(notFoundError('NoSuchKey'))
        return Promise.resolve({
          ContentType: stored.ContentType,
          Metadata: stored.Metadata,
          Body: { transformToByteArray: () => Promise.resolve(stored.Body) },
        })
      }
      if (command.constructor.name === 'PutObjectCommand') {
        puts.push(command.input)
        return Promise.resolve({})
      }
      throw new Error(`unexpected command: ${command.constructor.name}`)
    }) as any
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage)
      assertEquals(result.migrated, 0)
      assertEquals(result.skipped, 1)
      assertEquals(puts.length, 0, 'expected the concurrent write to never be overwritten')
    } finally {
      S3Client.prototype.send = originalSend
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- useWorker ---------------------------------------------------------------------------------

Deno.test(
  "rotateEncryptionKeys: useWorker: 'one-time' dispatches through WorkerManager and returns " +
    'the real result',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>([
      [
        'objects/worker/a',
        { Body: new TextEncoder().encode('via worker'), ContentType: 'x', Metadata: {} },
      ],
    ])
    const restore = installFakeBucket(store)
    const originalTask = WorkerManager.prototype.task
    let dispatched = false
    ;(WorkerManager.prototype as any).task = function (fn: any, options: any) {
      return {
        invoke: (...parameters: unknown[]) => {
          dispatched = true
          Promise.resolve(fn(...parameters)).then(
            (response) => options.onFinish?.({ response }),
            (error) => options.onFinish?.({ error }),
          )
        },
      }
    }
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage, { useWorker: 'one-time' })
      assert(dispatched, 'expected the rotation to actually go through WorkerManager.task')
      assertEquals(result.migrated, 1)
      assertEquals(store.get('objects/worker/a')?.Metadata['encryption-version'], 'v1')
    } finally {
      restore()
      WorkerManager.prototype.task = originalTask
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

Deno.test(
  "checkEncryptionRotationStatus: useWorker: 'persisted' dispatches through the registered " +
    'worker provider',
  async () => {
    const store = new Map<string, FakeObject>([
      ['a', { Body: new Uint8Array(), ContentType: 'x', Metadata: { 'encryption-version': 'v1' } }],
    ])
    const restore = installFakeBucket(store)
    const proto = Object.getPrototypeOf(ProgramModule)
    const originalGetProviders = proto.getProviders
    let dispatched = false
    proto.getProviders = () => ({
      get: () => ({
        executeGeneralTask: (fn: any, options: any) => (...args: unknown[]) => {
          dispatched = true
          Promise.resolve(fn(...args)).then(
            (response) => options.callback?.({ response }),
            (error) => options.callback?.({ error }),
          )
        },
      }),
    })
    const originalTask = WorkerManager.prototype.task
    let fellBackToOneTime = false
    ;(WorkerManager.prototype as any).task = function (...args: unknown[]) {
      fellBackToOneTime = true
      return originalTask.apply(this, args as never)
    }
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const status = await checkEncryptionRotationStatus(storage, { useWorker: 'persisted' })
      assert(dispatched, "expected the scan to go through the registered 'worker' provider")
      assertEquals(fellBackToOneTime, false)
      assertEquals(status.totalObjects, 1)
      assertEquals(status.onActiveVersion, 1)
    } finally {
      restore()
      proto.getProviders = originalGetProviders
      WorkerManager.prototype.task = originalTask
    }
  },
)

Deno.test(
  "rotateEncryptionKeys: useWorker: 'persisted' falls back to 'one-time' when no worker " +
    'provider is registered',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const store = new Map<string, FakeObject>([
      ['objects/fallback/a', {
        Body: new TextEncoder().encode('irrelevant'),
        ContentType: 'x',
        Metadata: {},
      }],
    ])
    const restore = installFakeBucket(store)
    const proto = Object.getPrototypeOf(ProgramModule)
    const originalGetProviders = proto.getProviders
    // No 'worker' provider registered at all — resolving it must throw, triggering the fallback.
    proto.getProviders = () => ({
      get: () => {
        throw new Error("no 'worker' provider registered")
      },
    })
    const originalTask = WorkerManager.prototype.task
    let usedOneTimeFallback = false
    ;(WorkerManager.prototype as any).task = function (fn: any, options: any) {
      usedOneTimeFallback = true
      return {
        invoke: (...parameters: unknown[]) => {
          Promise.resolve(fn(...parameters)).then(
            (response) => options.onFinish?.({ response }),
            (error) => options.onFinish?.({ error }),
          )
        },
      }
    }
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage, { useWorker: 'persisted' })
      assert(usedOneTimeFallback, "expected 'persisted' to fall back to WorkerManager.task")
      assertEquals(result.migrated, 1)
    } finally {
      restore()
      proto.getProviders = originalGetProviders
      WorkerManager.prototype.task = originalTask
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

Deno.test(
  'rotateEncryptionKeys: useWorker propagates a real error thrown inside the worker as a ' +
    'rejection of the returned promise, not a silently empty result',
  async () => {
    // No `encrypt` configured on the RECONSTRUCTED worker-side instance would be a mismatch bug —
    // here we simulate the real failure mode instead: the worker-side reconstruction throws
    // because the underlying S3 call itself fails for a non-missing reason.
    const store = new Map<string, FakeObject>([
      ['a', { Body: new Uint8Array(), ContentType: 'x', Metadata: {} }],
    ])
    S3Client.prototype.send = (() => Promise.reject(new Error('ECONNREFUSED'))) as any
    const originalTask = WorkerManager.prototype.task
    ;(WorkerManager.prototype as any).task = function (fn: any, options: any) {
      return {
        invoke: (...parameters: unknown[]) => {
          Promise.resolve(fn(...parameters)).then(
            (response) => options.onFinish?.({ response }),
            (error) => options.onFinish?.({ error }),
          )
        },
      }
    }
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      await assertRejects(
        () => rotateEncryptionKeys(storage, { useWorker: 'one-time' }),
        Error,
        'ECONNREFUSED',
      )
      void store // referenced only to document what a successful run would have touched
    } finally {
      S3Client.prototype.send = originalSend
      WorkerManager.prototype.task = originalTask
    }
  },
)

// --- prefix scoping: keys outside the prefix are never touched -------------------------------

Deno.test(
  'checkEncryptionRotationStatus scopes the scan to the given prefix — keys outside it are ' +
    'never counted',
  async () => {
    const store = new Map<string, FakeObject>([
      ['scope/a', {
        Body: new Uint8Array(),
        ContentType: 'x',
        Metadata: { 'encryption-version': 'v1' },
      }],
      ['scope/b', {
        Body: new Uint8Array(),
        ContentType: 'x',
        Metadata: { 'encryption-version': 'v1' },
      }],
      ['other/c', { Body: new Uint8Array(), ContentType: 'x', Metadata: {} }],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const status = await checkEncryptionRotationStatus(storage, { prefix: 'scope/' })
      assertEquals(status.totalObjects, 2)
      assertEquals(status.onActiveVersion, 2)
      assertEquals(status.unencrypted, 0, 'expected other/c (outside the prefix) never counted')
    } finally {
      restore()
    }
  },
)

Deno.test(
  'rotateEncryptionKeys scopes the run to the given prefix — keys outside it are never touched',
  async () => {
    Deno.env.set('DATA_AES_KEY_V1', 'the-v1-key')
    const outsidePlaintext = new TextEncoder().encode('never touched')
    const store = new Map<string, FakeObject>([
      ['scope/a', { Body: new TextEncoder().encode('inside'), ContentType: 'x', Metadata: {} }],
      ['other/b', { Body: outsidePlaintext, ContentType: 'x', Metadata: {} }],
    ])
    const restore = installFakeBucket(store)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'symmetric', version: 'v1' },
      })
      const result = await rotateEncryptionKeys(storage, { prefix: 'scope/' })
      assertEquals(result.scanned, 1)
      assertEquals(result.migrated, 1)
      assertEquals(store.get('scope/a')?.Metadata['encryption-version'], 'v1')
      assertEquals(
        store.get('other/b')?.Body,
        outsidePlaintext,
        'expected the out-of-prefix object to be untouched, never scanned or re-encrypted',
      )
      assertEquals(store.get('other/b')?.Metadata['encryption-version'], undefined)
    } finally {
      restore()
      Deno.env.delete('DATA_AES_KEY_V1')
    }
  },
)

// --- asymmetric encryption: real envelope re-encryption round trip ----------------------------

Deno.test(
  'rotateEncryptionKeys re-encrypts a real object from an old ASYMMETRIC version to the active ' +
    'one, and it decrypts correctly afterwards',
  async () => {
    const v1Keys = await generateRSAKeys()
    const v2Keys = await generateRSAKeys()
    Deno.env.set('DATA_RSA_PUB_V1', btoa(v1Keys.publicKey))
    Deno.env.set('DATA_RSA_KEY_V1', btoa(v1Keys.privateKey))
    Deno.env.set('DATA_RSA_PUB_V2', btoa(v2Keys.publicKey))
    Deno.env.set('DATA_RSA_KEY_V2', btoa(v2Keys.privateKey))
    const store = new Map<string, FakeObject>()
    const restore = installFakeBucket(store)
    try {
      const v1Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'asymmetric', version: 'v1' },
      })
      const plaintext = new TextEncoder().encode('rotate me to v2, asymmetrically')
      await v1Storage.put('objects/asym/a', plaintext, { contentType: 'text/plain' })
      assertEquals(store.get('objects/asym/a')?.Metadata['encryption-version'], 'v1')

      const v2Storage = new S3ObjectStorage({
        autoInitialize: false,
        bucket: 'test',
        encrypt: { type: 'asymmetric', version: 'v2' },
      })
      const result = await rotateEncryptionKeys(v2Storage)
      assertEquals(result.migrated, 1)
      assertEquals(result.failed, [])
      assertEquals(store.get('objects/asym/a')?.Metadata['encryption-version'], 'v2')
      assert(
        store.get('objects/asym/a')?.Metadata['wrapped-key'],
        'expected a NEW per-object wrapped key under v2 after re-encryption',
      )

      const fetched = await v2Storage.get('objects/asym/a')
      assert(fetched, 'expected the migrated object to still be readable')
      assertEquals(new Uint8Array(await new Response(fetched.stream).arrayBuffer()), plaintext)
    } finally {
      restore()
      Deno.env.delete('DATA_RSA_PUB_V1')
      Deno.env.delete('DATA_RSA_KEY_V1')
      Deno.env.delete('DATA_RSA_PUB_V2')
      Deno.env.delete('DATA_RSA_KEY_V2')
    }
  },
)
