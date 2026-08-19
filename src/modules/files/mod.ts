/**
 * A generic, durable file record registry for the Zanix ecosystem — `MongoFileRepository`, backed by
 * this package's Mongo connector. Deliberately agnostic of what a file represents or what state it's
 * in; a `metadata` bag on each record is the one place a caller attaches domain-specific data. Bytes
 * are a separate concern, handled by `../storage/` (`SeaweedFSObjectStorage`) — this module never
 * touches object content. See `docs/STORAGE.md` for the full architecture and setup guide.
 *
 * @module zanixFiles
 */

export {
  DEFAULT_FILE_MODEL,
  FILE_MODEL_ENV,
  fileModelName,
  registerFileModel,
} from './files.model.ts'
export type { FileModelAttrs, RegisterFileModelOptions } from './files.model.ts'
export { MongoFileRepository } from './files.repository.ts'
export type { CreateFileInput, FileRecord, UpdateFileInput } from './files.repository.ts'
