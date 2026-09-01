// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from '@std/assert'
import { upsertById, upsertManyById } from 'mongo/processor/schema/statics/upsert.ts'
import logger from '@zanix/logger'

const buildFakeModel = (hasDataProtection = false) => {
  const calls: any[] = []
  return {
    calls,
    _hasDataProtection: () => hasDataProtection,
    updateOne: (filter: any, update: any, options: any) => {
      calls.push({ op: 'updateOne', filter, update, options })
      return Promise.resolve()
    },
    bulkWrite: (ops: any, options: any) => {
      calls.push({ op: 'bulkWrite', ops, options })
      return Promise.resolve()
    },
    schema: {
      emit: (
        event: string,
        _model: any,
        data: any,
        options: any,
        next: () => void,
      ) => {
        calls.push({ op: 'emit', event, data, options })
        next()
      },
    },
  }
}

Deno.test('upsertById performs an insert (setOnInsert) by default', async () => {
  const model = buildFakeModel()

  await upsertById.call(model as any, { id: '1', name: 'A' })

  assertEquals(model.calls[0].op, 'updateOne')
  assertEquals(model.calls[0].options, { upsert: true })
})

Deno.test('upsertById performs a $set update when type is "update"', async () => {
  const model = buildFakeModel()

  await upsertById.call(model as any, { id: '1', name: 'A' }, {
    type: 'update',
  })

  assertEquals(model.calls[0].update, { $set: { name: 'A' } })
  assertEquals(model.calls[0].options, {})
})

Deno.test({
  name: 'upsertById delegates to the schema data-policy event when protection is on',
  fn: async () => {
    const model = buildFakeModel(true)

    await upsertById.call(model as any, { id: '1', name: 'A' }, {
      useDataPolicies: true,
    })

    assertEquals(model.calls[0].op, 'emit')
    assertEquals(model.calls[0].event, 'upsertWithDataPolicy')
  },
})

Deno.test('upsertManyById does nothing when given an empty array', async () => {
  const model = buildFakeModel()

  await upsertManyById.call(model as any, [])

  assertEquals(model.calls.length, 0)
})

Deno.test('upsertManyById does nothing when given a non-array value', async () => {
  const model = buildFakeModel()

  await upsertManyById.call(model as any, undefined as never)

  assertEquals(model.calls.length, 0)
})

Deno.test('upsertManyById delegates to upsertById when given a single item', async () => {
  const model: any = buildFakeModel()
  model.upsertById = (data: any, options: any) => {
    model.calls.push({ op: 'upsertById', data, options })
  }

  await upsertManyById.call(model, [{ id: '1', name: 'A' }])

  assertEquals(model.calls[0].op, 'upsertById')
})

Deno.test('upsertManyById delegates to the schema data-policy event for many items', async () => {
  const model = buildFakeModel(true)

  await upsertManyById.call(model as any, [{ id: '1' }, { id: '2' }], {
    useDataPolicies: true,
  })

  assertEquals(model.calls[0].op, 'emit')
  assertEquals(model.calls[0].event, 'upsertManyWithDataPolicy')
})

Deno.test({
  name: 'upsertManyById performs a bulk $set update for many items in "update" mode',
  fn: async () => {
    const model = buildFakeModel()

    await upsertManyById.call(model as any, [{ id: '1', name: 'A' }, {
      id: '2',
      name: 'B',
    }], {
      type: 'update',
    })

    assertEquals(model.calls[0].op, 'bulkWrite')
    assertEquals(model.calls[0].ops[0].updateOne.update, {
      $set: { name: 'A' },
    })
  },
})

// --- bulkWrite retry ------------------------------------------------------------------------

const buildFakeModelWithBulkWrite = (
  bulkWrite: (ops: any, options: any) => Promise<void>,
) => ({
  _hasDataProtection: () => false,
  bulkWrite,
})

Deno.test('upsertManyById: a transient partial failure is retried and succeeds', async () => {
  let calls = 0
  const bulkWriteCalls: any[][] = []

  const model = buildFakeModelWithBulkWrite((ops: any) => {
    bulkWriteCalls.push(ops)
    calls++
    if (calls === 1) {
      const error: any = new Error('bulk write partial failure')
      error.writeErrors = [{ index: 1 }] // only the second op failed
      return Promise.reject(error)
    }
    return Promise.resolve()
  })

  await upsertManyById.call(model as any, [
    { id: '1', name: 'A' },
    { id: '2', name: 'B' },
    { id: '3', name: 'C' },
  ], { type: 'update' })

  assertEquals(calls, 2)
  assertEquals(bulkWriteCalls[0].length, 3) // first attempt: the full batch
  assertEquals(bulkWriteCalls[1].length, 1) // retry: only the one that failed (index 1 -> "B")
  assertEquals(bulkWriteCalls[1][0].updateOne.update, { $set: { name: 'B' } })
})

Deno.test('upsertManyById: gives up and rethrows after exhausting all retries', async () => {
  let calls = 0
  const model = buildFakeModelWithBulkWrite(() => {
    calls++
    const error: any = new Error('persistent failure')
    error.writeErrors = [{ index: 0 }]
    return Promise.reject(error)
  })

  const errors: unknown[] = []
  const originalError = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as any

  try {
    await assertRejects(
      () =>
        upsertManyById.call(model as any, [{ id: '1', name: 'A' }, {
          id: '2',
          name: 'B',
        }], {
          type: 'update',
        }),
      Error,
      'persistent failure',
    )
    assertEquals(calls, 4) // 1 initial attempt + 3 retries
    assert(errors.length > 0) // failure is surfaced via the logger too, not just the rejection
  } finally {
    logger.error = originalError
  }
})

Deno.test('upsertManyById: an error with no per-op writeErrors is never retried', async () => {
  let calls = 0
  const model = buildFakeModelWithBulkWrite(() => {
    calls++
    return Promise.reject(new Error('connection lost'))
  })

  await assertRejects(
    () =>
      upsertManyById.call(model as any, [{ id: '1', name: 'A' }, {
        id: '2',
        name: 'B',
      }], {
        type: 'update',
      }),
    Error,
    'connection lost',
  )
  assertEquals(calls, 1) // no retry attempted — this error would fail identically every time
})

Deno.test('upsertManyById: passes throwOnValidationError so cast failures reject instead of resolving silently', async () => {
  const model = buildFakeModel()

  await upsertManyById.call(model as any, [{ id: '1', name: 'A' }, {
    id: '2',
    name: 'B',
  }])

  assertEquals(model.calls[0].op, 'bulkWrite')
  assertEquals(model.calls[0].options.throwOnValidationError, true)
})

Deno.test(
  'upsertManyById: a MongooseBulkWriteError (every op failed to cast) rejects and is never retried',
  async () => {
    // mongoose's `bulkWrite` with `throwOnValidationError: true` throws a `MongooseBulkWriteError`
    // for client-side cast/validation failures — it carries no `.writeErrors` (only a real
    // server-side `MongoBulkWriteError` does), so the retry logic treats it like any other
    // non-per-op error: surface it immediately, never retry it.
    let calls = 0
    const model = buildFakeModelWithBulkWrite(() => {
      calls++
      const error: any = new Error(
        'bulkWrite failed with 2 Mongoose validation errors: Cast to ObjectId failed, Cast to ObjectId failed',
      )
      error.name = 'MongooseBulkWriteError'
      error.validationErrors = [
        { index: 0, error: new Error('Cast to ObjectId failed') },
        { index: 1, error: new Error('Cast to ObjectId failed') },
      ]
      // no `.writeErrors` — this is the real, confirmed shape of MongooseBulkWriteError
      return Promise.reject(error)
    })

    await assertRejects(
      () =>
        upsertManyById.call(model as any, [
          { id: 'not-a-valid-object-id', name: 'A' },
          { id: 'also-not-valid', name: 'B' },
        ]),
      Error,
      'Mongoose validation errors',
    )
    assertEquals(calls, 1) // no retry attempted — a cast failure fails identically every time
  },
)
