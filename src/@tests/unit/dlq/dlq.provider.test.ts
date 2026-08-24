import { assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { DlqProvider } from 'modules/dlq/dlq.provider.ts'

// deno-lint-ignore no-explicit-any
type Entry = Record<string, any>

/** Resolves a dot-notation path (e.g. `'payload.orderId'`), mirroring Mongo's own field lookup. */
function getPath(entry: Entry, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (v, k) => (v as Entry | undefined)?.[k],
    entry,
  )
}

/** Minimal in-memory Mongo-filter matcher — supports only the shapes `DlqProvider` actually emits. */
function matches(entry: Entry, filter: Entry): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') {
      return (cond as Entry[]).some((sub) => matches(entry, sub))
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.entries(cond as Entry).every(([op, val]) => {
        if (op === '$exists') {
          return (getPath(entry, key) !== undefined) === val
        }
        if (op === '$lt') {
          const value = getPath(entry, key)
          return value !== undefined && (value as Date) < (val as Date)
        }
        if (op === '$in') {
          return (val as unknown[]).includes(getPath(entry, key))
        }
        return getPath(entry, key) === val
      })
    }
    return getPath(entry, key) === cond
  })
}

function applyUpdate(entry: Entry, update: Entry): Entry {
  if (update.$set) Object.assign(entry, update.$set)
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) delete entry[k]
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      entry[k] = (entry[k] ?? 0) + (v as number)
    }
  }
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      entry[k] = [...(entry[k] || []), v]
    }
  }
  return entry
}

let nextId = 1

function fakeThis(entries: Entry[]) {
  const model = {
    create: (doc: Entry) => {
      const entry = { _id: `id-${nextId++}`, ...doc }
      entries.push(entry)
      return Promise.resolve(entry)
    },
    findOne: (filter: Entry) => Promise.resolve(entries.find((e) => matches(e, filter))),
    findOneAndUpdate: (filter: Entry, update: Entry) => {
      const entry = entries.find((e) => matches(e, filter))
      return Promise.resolve(entry ? applyUpdate(entry, update) : undefined)
    },
    paginate: ({ filter = {}, page = 1, limit = 10 }: Entry = {}) => {
      const docs = entries.filter((e) => matches(e, filter))
      return Promise.resolve({
        docs,
        page,
        limit,
        total: docs.length,
        totalPages: Math.ceil(docs.length / limit),
        hasNextPage: false,
        hasPrevPage: page > 1,
      })
    },
    deleteOne: (filter: Entry) => {
      const index = entries.findIndex((e) => matches(e, filter))
      if (index === -1) return Promise.resolve({ deletedCount: 0 })
      entries.splice(index, 1)
      return Promise.resolve({ deletedCount: 1 })
    },
  }
  const instance = Object.create(DlqProvider.prototype)
  Object.defineProperty(instance, 'database', {
    value: { isReady: Promise.resolve(), getModel: () => model },
  })
  return instance
}

const provider = DlqProvider.prototype

const baseInput = {
  processType: 'payment.process',
  origin: 'orders-service',
  payload: { orderId: 'abc123' },
  error: { name: 'Error', message: 'boom' },
}

Deno.test('DlqProvider.push creates a pending entry with attempts: 0', async () => {
  const entries: Entry[] = []
  const result = await provider.push.call(
    fakeThis(entries) as never,
    baseInput,
  )

  assertEquals(result.status, 'pending')
  assertEquals(result.attempts, 0)
  assertEquals(result.payload, { orderId: 'abc123' })
  assertEquals(result.errorHistory.length, 1)
  assertEquals(result.errorHistory[0].attempt, 0)
})

Deno.test('DlqProvider.get returns a native payload as-is (default, unencrypted)', async () => {
  const entries: Entry[] = [{
    _id: 'id-1',
    payload: { orderId: 'xyz' },
    status: 'pending',
  }]
  const result = await provider.get.call(fakeThis(entries) as never, 'id-1')
  assertEquals(result.payload, { orderId: 'xyz' })
})

Deno.test('DlqProvider.get falls back to parsing payloadRaw when payload is absent', async () => {
  const entries: Entry[] = [{
    _id: 'id-1',
    payloadRaw: JSON.stringify({ orderId: 'xyz' }),
    status: 'pending',
  }]
  const result = await provider.get.call(fakeThis(entries) as never, 'id-1')
  assertEquals(result.payload, { orderId: 'xyz' })
})

Deno.test('DlqProvider.get throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => provider.get.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})

Deno.test('DlqProvider.get decrypts payloadRaw when it is a DecryptableObject', async () => {
  const entries: Entry[] = [{
    _id: 'id-1',
    payloadRaw: {
      decrypt: () => Promise.resolve(JSON.stringify({ secret: true })),
    },
    status: 'pending',
  }]
  const result = await provider.get.call(fakeThis(entries) as never, 'id-1')
  assertEquals(result.payload, { secret: true })
})

Deno.test('DlqProvider.list filters by processType/status/origin', async () => {
  const entries: Entry[] = [
    {
      _id: '1',
      payloadRaw: '{}',
      processType: 'a',
      status: 'pending',
      origin: 'x',
    },
    {
      _id: '2',
      payloadRaw: '{}',
      processType: 'b',
      status: 'pending',
      origin: 'x',
    },
  ]
  const result = await provider.list.call(fakeThis(entries) as never, {
    processType: 'a',
  })
  assertEquals(result.docs.length, 1)
  assertEquals(result.docs[0]._id, '1')
})

Deno.test('DlqProvider.list merges a raw filter passthrough, querying into payload', async () => {
  const entries: Entry[] = [
    { _id: '1', payload: { orderId: 'abc123' }, status: 'pending' },
    { _id: '2', payload: { orderId: 'other' }, status: 'pending' },
  ]
  const result = await provider.list.call(fakeThis(entries) as never, {
    filter: { 'payload.orderId': 'abc123' },
  })
  assertEquals(result.docs.length, 1)
  assertEquals(result.docs[0]._id, '1')
})

Deno.test('DlqProvider.list strips a $-operator out of a raw filter passthrough', async () => {
  const entries: Entry[] = []
  const instance = fakeThis(entries)
  let capturedFilter: Entry | undefined
  const model = instance.database.getModel()
  const originalPaginate = model.paginate
  model.paginate = (opts: Entry) => {
    capturedFilter = opts.filter
    return originalPaginate(opts)
  }

  await provider.list.call(instance as never, {
    filter: { 'payload.orderId': 'abc123', $where: 'this.attempts > 999' },
  })

  assertEquals(capturedFilter, { 'payload.orderId': 'abc123' })
})

Deno.test('DlqProvider.list: processType/status/origin win over a filter key clash', async () => {
  const entries: Entry[] = []
  const instance = fakeThis(entries)
  let capturedFilter: Entry | undefined
  const model = instance.database.getModel()
  const originalPaginate = model.paginate
  model.paginate = (opts: Entry) => {
    capturedFilter = opts.filter
    return originalPaginate(opts)
  }

  await provider.list.call(instance as never, {
    status: 'pending',
    filter: { status: 'completed' },
  })

  assertEquals(capturedFilter?.status, 'pending')
})

Deno.test('DlqProvider.claim atomically claims one eligible pending entry', async () => {
  const entries: Entry[] = [
    { _id: '1', payloadRaw: '{}', status: 'pending', attempts: 0 },
  ]
  const result = await provider.claim.call(fakeThis(entries) as never, {
    leaseOwner: 'w1',
  })

  assertEquals(result?.status, 'claimed')
  assertEquals(result?.leaseOwner, 'w1')
  assertEquals(result?.attempts, 1)
})

Deno.test('DlqProvider.claim returns null when nothing is eligible', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'completed',
    attempts: 1,
  }]
  const result = await provider.claim.call(fakeThis(entries) as never, {
    leaseOwner: 'w1',
  })
  assertEquals(result, null)
})

Deno.test('DlqProvider.claim ignores a claimed entry with an unexpired lease', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    attempts: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  }]
  const result = await provider.claim.call(fakeThis(entries) as never, {
    leaseOwner: 'w2',
  })
  assertEquals(result, null)
})

Deno.test('DlqProvider.claim reclaims an abandoned entry (claimed, expired lease)', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    attempts: 1,
    leaseExpiresAt: new Date(Date.now() - 1000),
  }]
  const result = await provider.claim.call(fakeThis(entries) as never, {
    leaseOwner: 'w2',
  })
  assertEquals(result?.leaseOwner, 'w2')
  assertEquals(result?.attempts, 2)
})

Deno.test("DlqProvider.claim: a filter's status can't override built-in eligibility", async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'completed',
    attempts: 1,
  }]
  const result = await provider.claim.call(fakeThis(entries) as never, {
    leaseOwner: 'w1',
    // A caller-supplied 'status' must never widen eligibility to an already-terminal entry.
    filter: { status: 'completed' },
  })
  assertEquals(result, null)
})

Deno.test('DlqProvider.claim strips a $-operator out of its filter passthrough', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'pending',
    attempts: 0,
  }]
  const instance = fakeThis(entries)
  let capturedFilter: Entry | undefined
  const model = instance.database.getModel()
  const originalFindOneAndUpdate = model.findOneAndUpdate
  model.findOneAndUpdate = (filter: Entry, update: Entry) => {
    capturedFilter = filter
    return originalFindOneAndUpdate(filter, update)
  }

  await provider.claim.call(instance as never, {
    leaseOwner: 'w1',
    filter: { $where: 'true' },
  })

  assertEquals(capturedFilter?.$where, undefined)
})

Deno.test('DlqProvider.release moves a claimed entry back to pending', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
    leaseExpiresAt: new Date(),
  }]
  const result = await provider.release.call(fakeThis(entries) as never, '1', {
    leaseOwner: 'w1',
  })
  assertEquals(result.status, 'pending')
  assertEquals(result.leaseOwner, undefined)
})

Deno.test('DlqProvider.release throws CONFLICT on a leaseOwner mismatch', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
  }]
  await assertRejects(
    () =>
      provider.release.call(fakeThis(entries) as never, '1', {
        leaseOwner: 'w2',
      }),
    HttpError,
  )
})

Deno.test('DlqProvider.complete moves a claimed entry to completed', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
  }]
  const result = await provider.complete.call(fakeThis(entries) as never, '1', {
    leaseOwner: 'w1',
  })
  assertEquals(result.status, 'completed')
})

Deno.test('DlqProvider.complete throws CONFLICT on a leaseOwner mismatch', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
  }]
  await assertRejects(
    () =>
      provider.complete.call(fakeThis(entries) as never, '1', {
        leaseOwner: 'nope',
      }),
    HttpError,
  )
})

Deno.test('DlqProvider.fail moves back to pending when attempts remain', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
    attempts: 1,
    maxAttempts: 3,
    errorHistory: [],
  }]
  const result = await provider.fail.call(fakeThis(entries) as never, '1', {
    leaseOwner: 'w1',
    error: { name: 'Error', message: 'retry me' },
  })
  assertEquals(result.status, 'pending')
  assertEquals(result.error.message, 'retry me')
  assertEquals(result.errorHistory.length, 1)
})

Deno.test('DlqProvider.fail moves to failed once maxAttempts is reached', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'claimed',
    leaseOwner: 'w1',
    attempts: 3,
    maxAttempts: 3,
    errorHistory: [],
  }]
  const result = await provider.fail.call(fakeThis(entries) as never, '1', {
    leaseOwner: 'w1',
    error: { name: 'Error', message: 'exhausted' },
  })
  assertEquals(result.status, 'failed')
})

Deno.test('DlqProvider.fail throws CONFLICT when there is no active claim', async () => {
  const entries: Entry[] = [{ _id: '1', payloadRaw: '{}', status: 'pending' }]
  await assertRejects(
    () =>
      provider.fail.call(fakeThis(entries) as never, '1', {
        leaseOwner: 'w1',
        error: { name: 'Error', message: 'x' },
      }),
    HttpError,
  )
})

Deno.test('DlqProvider.requeue forces back to pending regardless of maxAttempts', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'failed',
    attempts: 5,
    maxAttempts: 3,
  }]
  const result = await provider.requeue.call(fakeThis(entries) as never, '1')
  assertEquals(result.status, 'pending')
  assertEquals(result.attempts, 5)
})

Deno.test('DlqProvider.requeue can reset attempts back to 0', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'failed',
    attempts: 5,
  }]
  const result = await provider.requeue.call(fakeThis(entries) as never, '1', {
    resetAttempts: true,
  })
  assertEquals(result.attempts, 0)
})

Deno.test('DlqProvider.requeue throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => provider.requeue.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})

Deno.test('DlqProvider.discard closes an entry without deleting it', async () => {
  const entries: Entry[] = [{ _id: '1', payloadRaw: '{}', status: 'pending' }]
  const result = await provider.discard.call(fakeThis(entries) as never, '1')
  assertEquals(result.status, 'discarded')
  assertEquals(entries.length, 1)
})

Deno.test('DlqProvider.discard throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => provider.discard.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})

Deno.test('DlqProvider.remove deletes an existing entry', async () => {
  const entries: Entry[] = [{
    _id: '1',
    payloadRaw: '{}',
    status: 'discarded',
  }]
  await provider.remove.call(fakeThis(entries) as never, '1')
  assertEquals(entries.length, 0)
})

Deno.test('DlqProvider.remove throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => provider.remove.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})
