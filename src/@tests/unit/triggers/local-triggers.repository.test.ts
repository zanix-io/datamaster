import { assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { TriggersAdminRepository } from 'modules/triggers/triggers.repository.ts'

// deno-lint-ignore no-explicit-any
function fakeThis(entries: Record<string, any>[]) {
  const model = {
    find: () => Promise.resolve(entries),
    findOne: ({ model }: { model: string }) =>
      Promise.resolve(entries.find((e) => e.model === model)),
    create: (doc: unknown) => Promise.resolve(doc),
    findOneAndUpdate: (
      { model }: { model: string },
      { $set }: { $set: Record<string, unknown> },
    ) => {
      const entry = entries.find((e) => e.model === model)
      return Promise.resolve(entry ? { ...entry, ...$set } : undefined)
    },
    deleteOne: ({ model }: { model: string }) => {
      const index = entries.findIndex((e) => e.model === model)
      if (index === -1) return Promise.resolve({ deletedCount: 0 })
      entries.splice(index, 1)
      return Promise.resolve({ deletedCount: 1 })
    },
  }
  const instance = Object.create(TriggersAdminRepository.prototype)
  Object.defineProperty(instance, 'database', {
    value: { isReady: Promise.resolve(), getModel: () => model },
  })
  return instance
}

const repo = TriggersAdminRepository.prototype

Deno.test('TriggersAdminRepository.list returns every persisted entry', async () => {
  const entries = [{
    model: 'users',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  const result = await repo.list.call(fakeThis(entries) as never)
  assertEquals(result, entries)
})

Deno.test('TriggersAdminRepository.get returns the matching entry', async () => {
  const entries = [{
    model: 'users',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  const result = await repo.get.call(fakeThis(entries) as never, 'users')
  assertEquals(result.model, 'users')
})

Deno.test('TriggersAdminRepository.get throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => repo.get.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})

Deno.test('TriggersAdminRepository.create rejects a duplicate model', async () => {
  const entries = [{
    model: 'users',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  await assertRejects(
    () =>
      repo.create.call(fakeThis(entries) as never, {
        model: 'users',
        active: true,
        triggers: {},
      }),
    HttpError,
  )
})

Deno.test('TriggersAdminRepository.create always sets isDefault: false', async () => {
  const created = await repo.create.call(fakeThis([]) as never, {
    model: 'orders',
    active: true,
    triggers: { pre: { created: [] } },
  }) as { isDefault: boolean; model: string }
  assertEquals(created.isDefault, false)
  assertEquals(created.model, 'orders')
})

Deno.test('TriggersAdminRepository.update throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => repo.update.call(fakeThis([]) as never, 'missing', { active: false }),
    HttpError,
  )
})

Deno.test('TriggersAdminRepository.update applies partial changes', async () => {
  const entries = [{
    model: 'users',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  const updated = await repo.update.call(fakeThis(entries) as never, 'users', {
    active: false,
  })
  assertEquals(updated.active, false)
})

Deno.test('TriggersAdminRepository.remove throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => repo.remove.call(fakeThis([]) as never, 'missing'),
    HttpError,
  )
})

Deno.test('TriggersAdminRepository.remove deletes an existing entry', async () => {
  const entries = [{
    model: 'users',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  await repo.remove.call(fakeThis(entries) as never, 'users')
  assertEquals(entries.length, 0)
})
