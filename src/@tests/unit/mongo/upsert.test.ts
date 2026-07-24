// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { upsertById, upsertManyById } from 'mongo/processor/schema/statics/upsert.ts'

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
      emit: (event: string, _model: any, data: any, options: any, next: () => void) => {
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

  await upsertById.call(model as any, { id: '1', name: 'A' }, { type: 'update' })

  assertEquals(model.calls[0].update, { $set: { name: 'A' } })
  assertEquals(model.calls[0].options, {})
})

Deno.test({
  name: 'upsertById delegates to the schema data-policy event when protection is on',
  fn: async () => {
    const model = buildFakeModel(true)

    await upsertById.call(model as any, { id: '1', name: 'A' }, { useDataPolicies: true })

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

    await upsertManyById.call(model as any, [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], {
      type: 'update',
    })

    assertEquals(model.calls[0].op, 'bulkWrite')
    assertEquals(model.calls[0].ops[0].updateOne.update, { $set: { name: 'A' } })
  },
})
