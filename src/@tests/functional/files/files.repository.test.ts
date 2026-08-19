import { assert, assertEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../(setup)/mongo/connector.ts'
import { fileModelName, registerFileModel } from 'modules/files/files.model.ts'
import { MongoFileRepository } from 'modules/files/files.repository.ts'
import type { ZanixMongoConnector } from 'database/mod.ts'

console.error = () => {}

// deno-lint-ignore no-explicit-any
const repositoryFor = (db: ZanixMongoConnector): any => {
  const instance = Object.create(MongoFileRepository.prototype)
  Object.defineProperty(instance, 'database', { value: db })
  return instance
}

/** Connects, drops any leftover files collection from a previous run, and returns both the
 * connector and a `MongoFileRepository` bound to it — same rationale as `dlq.provider.test.ts`'s
 * own `freshProvider` (per-test `registerFileModel()`, since model registration is cleared per
 * connector construction). */
const freshRepository = async () => {
  registerFileModel()
  const db = await getDB()
  await DropCollection(db.getModel(fileModelName()), db)
  return { db, repository: repositoryFor(db) }
}

const teardown = async (db: ZanixMongoConnector) => {
  await DropCollection(db.getModel(fileModelName()), db)
  await db['close']()
}

Deno.test({
  ...sanitize,
  name: 'MongoFileRepository full lifecycle against a real Mongo connection',
  fn: async () => {
    const { db, repository } = await freshRepository()

    try {
      const created = await repository.create({
        id: crypto.randomUUID(),
        key: `objects/${crypto.randomUUID()}/data`,
        contentType: 'application/octet-stream',
        size: 4096,
        checksum: 'deadbeef',
        filename: 'report.pdf',
        metadata: { source: 'upload' },
      })
      assertEquals(created.filename, 'report.pdf')
      assertEquals(created.metadata, { source: 'upload' })

      const fetched = await repository.findById(created.id)
      assert(fetched)
      assertEquals(fetched.id, created.id)
      assertEquals(fetched.checksum, 'deadbeef')

      const updated = await repository.update(created.id, {
        checksum: 'feedface',
        metadata: { source: 'upload', reviewed: true },
      })
      assertEquals(updated.checksum, 'feedface')
      assertEquals(updated.metadata, { source: 'upload', reviewed: true })

      const missing = await repository.findById('does-not-exist')
      assertEquals(missing, undefined)

      await repository.delete(created.id)
      assertEquals(await repository.findById(created.id), undefined)
    } finally {
      await teardown(db)
    }
  },
  ignore,
})
