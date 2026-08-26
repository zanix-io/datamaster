import type { MongoModelDefinition } from 'mongo/typings/models.ts'

import { registerModel } from 'database/defs/models.ts'

/** Env var naming the files collection, in place of {@link RegisterFileModelOptions.modelName}. */
export const FILE_MODEL_ENV = 'FILE_MODEL_NAME'
/** Default files collection name when `FILE_MODEL_NAME` isn't set. */
export const DEFAULT_FILE_MODEL = 'zanix-files'

/** What the most recent `registerFileModel()` call was given for `modelName` — mirrors
 * `dlq.model.ts`'s own `registeredModelName` tracking, same rationale. */
let registeredModelName: string | undefined

/** Resolves the effective files collection name: `FILE_MODEL_NAME` always wins when set, then
 * `registerFileModel`'s own `modelName` option, then the built-in default. */
export const fileModelName = (): string =>
  Deno.env.get(FILE_MODEL_ENV) || registeredModelName || DEFAULT_FILE_MODEL

/**
 * Mongo document shape for a registered file record — deliberately generic: this package has no
 * knowledge of what a file represents (an asset, a backup, an upload, ...) or what state it's in —
 * that's the concern of whichever application-level domain stores one. `metadata` is the one place
 * a caller attaches whatever domain-specific fields it needs (a processing status, a kind, derived
 * variants, ...) without this schema having to know their shape.
 */
export interface FileModelAttrs {
  _id: string
  /** The object storage key this record describes — see `../storage/`'s own `ObjectStorage`. Not
   * assumed to come from any particular storage backend. */
  key: string
  contentType: string
  size: number
  checksum: string
  filename?: string
  /** Free-form, caller-owned data — never interpreted by this package. */
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface RegisterFileModelOptions {
  /** Overrides the files collection name for this registration — `zanix-files` otherwise.
   * `FILE_MODEL_NAME`, when set, always wins over this. */
  modelName?: string
}

/**
 * Registers `@zanix/datamaster`'s own generic files model (`zanix-files` by default, or
 * `FILE_MODEL_NAME`/{@link RegisterFileModelOptions.modelName}) — required once, in the app's own
 * bootstrap, before `MongoFileRepository` can resolve it (mirrors `registerDlqModel`'s own usage).
 *
 * `_id` is declared explicitly as a `String` rather than left as Mongoose's default `ObjectId` — a
 * caller assigns the record's id up front (matching the object storage key's own identity) rather
 * than relying on an auto-generated one, and this model persists that exact value as the document's
 * native identity instead of maintaining a separate business-key field alongside an auto-generated
 * one.
 *
 * @param connector - An already-`@Connector`-decorated class for a non-default Mongo connector.
 * Omit for the default connector — see `registerModel`'s own `connector` parameter.
 * @param options - See {@link RegisterFileModelOptions}.
 *
 * @example
 * ```ts
 * import { registerFileModel } from '@zanix/datamaster/files'
 *
 * registerFileModel() // default connector, default collection name
 * registerFileModel({ modelName: 'app-files' })
 * ```
 */
export const registerFileModel = (
  options: RegisterFileModelOptions = {},
  // deno-lint-ignore ban-types
  connector: Function | undefined = undefined,
): void => {
  registeredModelName = options.modelName

  const definition: MongoModelDefinition<FileModelAttrs>['definition'] = {
    _id: { type: String, required: true },
    key: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true },
    filename: { type: String },
    metadata: { type: Object },
  } as MongoModelDefinition<FileModelAttrs>['definition']

  registerModel<FileModelAttrs>({
    name: fileModelName(),
    definition,
    options: { timestamps: true },
    callback: (schema) => {
      // For lookups by the object storage key this record describes.
      schema.index({ key: 1 })
      return schema
    },
  }, connector)
}
