import type { Model } from 'database/mod.ts'
import type { ZanixMongoConnector } from 'database/mod.ts'
import type { FileModelAttrs } from './files.model.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { fileModelName } from './files.model.ts'

/** A registered file's own record — generic on purpose, see `files.model.ts`'s own doc. */
export interface FileRecord {
  id: string
  key: string
  contentType: string
  size: number
  checksum: string
  filename?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** `id` is caller-assigned rather than repository-generated — matches the object storage key's own
 * caller-assigned identity (see `../storage/`'s `ObjectStorage`), and never forces a particular id
 * scheme on this Mongo-backed implementation: it's persisted as the document's native `_id`. */
export interface CreateFileInput {
  id: string
  key: string
  contentType: string
  size: number
  checksum: string
  filename?: string
  metadata?: Record<string, unknown>
}

export interface UpdateFileInput {
  checksum?: string
  size?: number
  contentType?: string
  filename?: string
  metadata?: Record<string, unknown>
}

/** Maps a persisted Mongo document back to `FileRecord` — `_id` becomes `id`, `createdAt`/
 * `updatedAt` become ISO strings (Mongoose returns real `Date` instances). */
function toRecord(doc: FileModelAttrs & { _id: string }): FileRecord {
  return {
    id: doc._id,
    key: doc.key,
    contentType: doc.contentType,
    size: doc.size,
    checksum: doc.checksum,
    filename: doc.filename,
    metadata: doc.metadata,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }
}

/**
 * A generic, durable registry of file records, backed by `ZanixMongoConnector`. Follows the same
 * `@Provider`/`ZanixProvider<{database: ZanixMongoConnector}>` shape as `TriggersAdminRepository`
 * (`../triggers/triggers.repository.ts`) and `DlqProvider` (`../dlq/dlq.provider.ts`).
 *
 * `create()`/`findById()` never throw for an unexpected reason of their own (missing-id is simply
 * `undefined` for `findById`); `update()` throws `HttpError('NOT_FOUND')` for a missing id.
 * `delete()` is a no-op for a missing id.
 */
@Provider()
export class MongoFileRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** Resolves the underlying files `Model` once the connector is ready. */
  private async model(): Promise<Model<FileModelAttrs>> {
    await this.database.isReady
    return this.database.getModel<FileModelAttrs>(fileModelName())
  }

  public async create(input: CreateFileInput): Promise<FileRecord> {
    const Model = await this.model()
    const created = await Model.create({
      _id: input.id,
      key: input.key,
      contentType: input.contentType,
      size: input.size,
      checksum: input.checksum,
      filename: input.filename,
      metadata: input.metadata,
    })
    return toRecord(created as unknown as FileModelAttrs & { _id: string })
  }

  public async findById(id: string): Promise<FileRecord | undefined> {
    const Model = await this.model()
    const found = await Model.findById(id)
    return found ? toRecord(found as unknown as FileModelAttrs & { _id: string }) : undefined
  }

  /** @throws {HttpError} `NOT_FOUND` if no entry exists for `id`. */
  public async update(id: string, changes: UpdateFileInput): Promise<FileRecord> {
    const Model = await this.model()
    const updated = await Model.findByIdAndUpdate(id, { $set: changes }, { new: true })
    if (!updated) throw new HttpError('NOT_FOUND', { meta: { id, source: 'zanix' } })
    return toRecord(updated as unknown as FileModelAttrs & { _id: string })
  }

  public async delete(id: string): Promise<void> {
    const Model = await this.model()
    await Model.findByIdAndDelete(id)
  }
}
