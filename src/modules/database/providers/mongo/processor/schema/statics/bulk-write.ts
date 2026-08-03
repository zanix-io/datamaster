// deno-lint-ignore-file no-explicit-any
import type { AdaptedModel } from 'mongo/typings/models.ts'

import { dataProtectionSetterDefinition } from 'database/policies/protection.ts'
import { transformShallowByPaths } from '../transforms/shallow.ts'
import { Model as MongooseModel } from 'mongoose'

/**
 * Protects (hashes/masks/encrypts) the configured paths found in a single `bulkWrite` operation's
 * write payload — `updateOne`/`updateMany`'s `$set`/`$setOnInsert`, `insertOne`'s `document`, or
 * `replaceOne`'s `replacement` — in place, using the model's own schema-configured protection
 * config for each path (never guessing settings the caller would otherwise have to duplicate).
 */
function protectOp(
  op: Record<string, any>,
  dataProtection: Record<string, any>,
  allowedPaths: string[],
): Promise<unknown> | undefined {
  const transform = (value: string | string[], path: string) =>
    dataProtectionSetterDefinition(dataProtection[path], value)

  const targets = [
    op.updateOne?.update?.$set,
    op.updateOne?.update?.$setOnInsert,
    op.updateMany?.update?.$set,
    op.updateMany?.update?.$setOnInsert,
    op.insertOne?.document,
    op.replaceOne?.replacement,
  ].filter(Boolean)

  if (!targets.length) return

  return Promise.all(
    targets.map((target) => transformShallowByPaths(target, { allowedPaths, transform })),
  )
}

/**
 * `bulkWrite` override that adds an opt-in `useDataPolicies` write option, mirroring
 * `upsertById`/`upsertManyById`'s own flag — same purpose (protect configured paths before they
 * hit the database), extended to a raw `bulkWrite` call.
 *
 * Mongoose has no query-middleware hook for `bulkWrite` at all (unlike `updateOne`/
 * `findOneAndUpdate`, which the data-protection query hook covers directly) — this is why
 * `bulkWrite` needs its own static override rather than a `schema.pre('bulkWrite', ...)` hook,
 * which does not exist.
 *
 * @this {AdaptedModel} The bound Mongoose model.
 * @param writes - The bulk write operations, same shape `Model.bulkWrite` itself accepts.
 * @param options - The same options `Model.bulkWrite` accepts, plus `useDataPolicies`.
 * @returns Whatever the underlying `Model.bulkWrite` resolves to.
 */
export function protectedBulkWrite(
  this: AdaptedModel,
  writes: any[],
  options?: Record<string, any>,
): Promise<any> {
  const { useDataPolicies, ...writeOptions } = options ?? {}

  if (!useDataPolicies || !this._hasDataProtection()) {
    return MongooseModel.bulkWrite.call(this, writes, writeOptions)
  }

  const dataProtection = this._getDataProtection()
  const allowedPaths = this._getDataProtectionPaths()

  return Promise.all(writes.map((op) => protectOp(op, dataProtection, allowedPaths)))
    .then(() => MongooseModel.bulkWrite.call(this, writes, writeOptions))
}
