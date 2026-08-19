import { assert, assertEquals, assertRejects } from '@std/assert'
import type { ObjectStorage } from 'storage/typings/general.ts'
import { createFallbackObjectStorage } from 'storage/fallback-object-storage.ts'

/**
 * `createFallbackObjectStorage`'s own contract, exercised against two fast, controllable
 * in-memory `ObjectStorage` fakes — no real S3/filesystem needed to prove the combinator's own
 * behavior in isolation. Ported from `@zanix/space`'s own `fallback-asset-storage.test.ts`
 * (same combinator, generalized) — same scenarios, same rigor.
 */

function createInMemoryObjectStorage(): ObjectStorage {
  const store = new Map<string, { bytes: Uint8Array; contentType: string; checksum: string }>()
  return {
    put(key, data, meta) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array()
      const checksum = `checksum-${key}`
      store.set(key, { bytes, contentType: meta.contentType, checksum })
      return Promise.resolve({
        key,
        contentType: meta.contentType,
        size: bytes.byteLength,
        checksum,
      })
    },
    get(key) {
      const found = store.get(key)
      if (!found) return Promise.resolve(undefined)
      return Promise.resolve({
        stream: new Response(new Uint8Array(found.bytes)).body as ReadableStream<Uint8Array>,
        object: {
          key,
          contentType: found.contentType,
          size: found.bytes.byteLength,
          checksum: found.checksum,
        },
      })
    },
    exists(key) {
      return Promise.resolve(store.has(key))
    },
    delete(key) {
      store.delete(key)
      return Promise.resolve()
    },
  }
}

/** An `ObjectStorage` whose every method THROWS — stands in for `SeaweedFSObjectStorage` reporting
 * a real infrastructure failure, as opposed to it genuinely resolving "this key doesn't exist"
 * (`undefined`/`false`). The distinction the "never silently fall back on an infra error" tests
 * below depend on. */
function createThrowingObjectStorage(message = 'infrastructure failure'): ObjectStorage {
  const fail = (): never => {
    throw new Error(message)
  }
  return { put: fail, get: fail, exists: fail, delete: fail }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

Deno.test(
  'createFallbackObjectStorage.put only ever writes to primary, never fallback',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()
    const storage = createFallbackObjectStorage(primary, fallback)

    await storage.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

    assertEquals(await primary.exists('a'), true)
    assertEquals(await fallback.exists('a'), false)
  },
)

Deno.test('createFallbackObjectStorage.get prefers primary when present in both', async () => {
  const primary = createInMemoryObjectStorage()
  const fallback = createInMemoryObjectStorage()
  await primary.put('a', new TextEncoder().encode('from-primary'), { contentType: 'text/plain' })
  await fallback.put('a', new TextEncoder().encode('from-fallback'), { contentType: 'text/plain' })

  const storage = createFallbackObjectStorage(primary, fallback)
  const found = await storage.get('a')
  assert(found)
  assertEquals(await readAll(found.stream), new TextEncoder().encode('from-primary'))
})

Deno.test(
  'createFallbackObjectStorage.get falls back to the secondary store when primary lacks the key',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()
    await fallback.put('a', new TextEncoder().encode('only-in-fallback'), {
      contentType: 'text/plain',
    })

    const storage = createFallbackObjectStorage(primary, fallback)
    const found = await storage.get('a')
    assert(found, 'expected the fallback-only object to still be found')
    assertEquals(await readAll(found.stream), new TextEncoder().encode('only-in-fallback'))
  },
)

Deno.test('createFallbackObjectStorage.get returns undefined when absent from both', async () => {
  const storage = createFallbackObjectStorage(
    createInMemoryObjectStorage(),
    createInMemoryObjectStorage(),
  )
  assertEquals(await storage.get('missing'), undefined)
})

Deno.test('createFallbackObjectStorage.exists is true if EITHER store has the key', async () => {
  const primary = createInMemoryObjectStorage()
  const fallback = createInMemoryObjectStorage()
  await fallback.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

  const storage = createFallbackObjectStorage(primary, fallback)
  assertEquals(await storage.exists('a'), true)
  assertEquals(await storage.exists('missing'), false)
})

// --- delete(): all 4 combinations, confirming no stale copy survives in EITHER backend. ---------

Deno.test(
  'createFallbackObjectStorage.delete: object exists in BOTH — removed from both',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()
    await primary.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })
    await fallback.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

    const storage = createFallbackObjectStorage(primary, fallback)
    await storage.delete('a')

    assertEquals(await primary.exists('a'), false)
    assertEquals(await fallback.exists('a'), false)
  },
)

Deno.test(
  'createFallbackObjectStorage.delete: object exists ONLY in fallback — removed, primary stays clean',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()
    await fallback.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

    const storage = createFallbackObjectStorage(primary, fallback)
    await storage.delete('a')

    assertEquals(await primary.exists('a'), false)
    assertEquals(
      await fallback.exists('a'),
      false,
      'a stale copy left in the fallback would resurface on a later get()',
    )
  },
)

Deno.test(
  'createFallbackObjectStorage.delete: object exists in NEITHER — a genuine no-op, never an error',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()

    const storage = createFallbackObjectStorage(primary, fallback)
    await storage.delete('never-existed')

    assertEquals(await primary.exists('never-existed'), false)
    assertEquals(await fallback.exists('never-existed'), false)
  },
)

Deno.test(
  'createFallbackObjectStorage: a failing ensureSynced hook is logged, never thrown — reads still ' +
    'work via the per-key fallback regardless',
  async () => {
    const primary = createInMemoryObjectStorage()
    const fallback = createInMemoryObjectStorage()
    await fallback.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

    const storage = createFallbackObjectStorage(
      primary,
      fallback,
      () => Promise.reject(new Error('bulk sync exploded')),
    )

    const found = await storage.get('a')
    assert(found, 'expected the read to succeed via the fallback despite the sync hook failing')
  },
)

Deno.test(
  'createFallbackObjectStorage: the ensureSynced hook runs before each operation',
  async () => {
    let calls = 0
    const storage = createFallbackObjectStorage(
      createInMemoryObjectStorage(),
      createInMemoryObjectStorage(),
      () => {
        calls++
        return Promise.resolve()
      },
    )

    await storage.exists('a')
    await storage.get('a')
    assertEquals(calls, 2)
  },
)

// --- The critical boundary: a primary that genuinely doesn't have the key (undefined/false) is a
// real fallback case; a primary that THROWS (a real infra failure) must propagate that failure —
// it must NEVER be treated the same as "not found", which would silently turn a real outage into
// a quiet local-disk read/write and mask the outage entirely. -----------------------------------

Deno.test(
  'createFallbackObjectStorage.get: when primary THROWS (an infra failure), the error ' +
    'propagates — it never falls back to the secondary store, even if the secondary DOES have ' +
    'the key',
  async () => {
    const primary = createThrowingObjectStorage('S3 unreachable')
    const fallback = createInMemoryObjectStorage()
    await fallback.put('a', new TextEncoder().encode('x'), { contentType: 'text/plain' })

    const storage = createFallbackObjectStorage(primary, fallback)
    await assertRejects(() => storage.get('a'), Error, 'S3 unreachable')
  },
)

Deno.test(
  'createFallbackObjectStorage.exists: when primary THROWS, the error propagates, never treated ' +
    'as "doesn\'t exist"',
  async () => {
    const primary = createThrowingObjectStorage('S3 unreachable')
    const storage = createFallbackObjectStorage(primary, createInMemoryObjectStorage())
    await assertRejects(() => storage.exists('a'), Error, 'S3 unreachable')
  },
)

Deno.test(
  'createFallbackObjectStorage.put: when primary THROWS, the error propagates',
  async () => {
    const primary = createThrowingObjectStorage('S3 unreachable')
    const storage = createFallbackObjectStorage(primary, createInMemoryObjectStorage())
    await assertRejects(
      () => storage.put('a', new Uint8Array([1]), { contentType: 'x' }),
      Error,
      'S3 unreachable',
    )
  },
)
