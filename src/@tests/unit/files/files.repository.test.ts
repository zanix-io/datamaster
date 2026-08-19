import { assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { MongoFileRepository } from 'modules/files/files.repository.ts'

// deno-lint-ignore no-explicit-any
function fakeThis(entries: Record<string, any>[]) {
  const model = {
    create: (doc: Record<string, unknown>) => {
      const now = new Date()
      const created = { ...doc, createdAt: now, updatedAt: now }
      entries.push(created)
      return Promise.resolve(created)
    },
    findById: (id: string) => Promise.resolve(entries.find((e) => e._id === id)),
    findByIdAndUpdate: (id: string, { $set }: { $set: Record<string, unknown> }) => {
      const entry = entries.find((e) => e._id === id)
      if (!entry) return Promise.resolve(undefined)
      Object.assign(entry, $set, { updatedAt: new Date() })
      return Promise.resolve(entry)
    },
    findByIdAndDelete: (id: string) => {
      const index = entries.findIndex((e) => e._id === id)
      if (index !== -1) entries.splice(index, 1)
      return Promise.resolve(undefined)
    },
  }
  const instance = Object.create(MongoFileRepository.prototype)
  Object.defineProperty(instance, 'database', {
    value: { isReady: Promise.resolve(), getModel: () => model },
  })
  return instance
}

const repo = MongoFileRepository.prototype

const baseInput = {
  id: 'file-1',
  key: 'objects/file-1/data',
  contentType: 'application/octet-stream',
  size: 128,
  checksum: 'abc123',
}

Deno.test(
  'MongoFileRepository.create persists the caller-assigned id as the native _id',
  async () => {
    const entries: Record<string, unknown>[] = []
    const created = await repo.create.call(fakeThis(entries) as never, baseInput)
    assertEquals(created.id, 'file-1')
    assertEquals(created.key, 'objects/file-1/data')
    assertEquals(created.checksum, 'abc123')
  },
)

Deno.test('MongoFileRepository.create persists an arbitrary metadata bag untouched', async () => {
  const entries: Record<string, unknown>[] = []
  const created = await repo.create.call(fakeThis(entries) as never, {
    ...baseInput,
    metadata: { kind: 'voice-memo', durationSeconds: 12 },
  })
  assertEquals(created.metadata, { kind: 'voice-memo', durationSeconds: 12 })
})

Deno.test('MongoFileRepository.findById returns undefined when the entry is missing', async () => {
  const found = await repo.findById.call(fakeThis([]) as never, 'missing')
  assertEquals(found, undefined)
})

Deno.test('MongoFileRepository.findById returns the matching entry', async () => {
  const entries: Record<string, unknown>[] = []
  await repo.create.call(fakeThis(entries) as never, baseInput)
  const found = await repo.findById.call(fakeThis(entries) as never, 'file-1')
  assertEquals(found?.id, 'file-1')
})

Deno.test('MongoFileRepository.update throws NOT_FOUND when the entry is missing', async () => {
  await assertRejects(
    () => repo.update.call(fakeThis([]) as never, 'missing', { checksum: 'new' }),
    HttpError,
  )
})

Deno.test('MongoFileRepository.update applies partial changes', async () => {
  const entries: Record<string, unknown>[] = []
  await repo.create.call(fakeThis(entries) as never, baseInput)
  const updated = await repo.update.call(fakeThis(entries) as never, 'file-1', {
    checksum: 'updated-checksum',
  })
  assertEquals(updated.checksum, 'updated-checksum')
  assertEquals(updated.id, 'file-1')
})

Deno.test('MongoFileRepository.delete removes an existing entry', async () => {
  const entries: Record<string, unknown>[] = []
  await repo.create.call(fakeThis(entries) as never, baseInput)
  await repo.delete.call(fakeThis(entries) as never, 'file-1')
  assertEquals(entries.length, 0)
})

Deno.test('MongoFileRepository.delete is a no-op for a missing entry', async () => {
  await repo.delete.call(fakeThis([]) as never, 'missing')
})
