// deno-lint-ignore-file no-explicit-any
import type { BaseCustomSchema } from 'mongo/typings/schema.ts'

import { dataProtectionSetterDefinition } from 'database/policies/protection.ts'
import { transformShallowByPaths } from '../schema/transforms/shallow.ts'
import { AUTO_PROTECT_ON_UPDATE_ENV } from 'database/utils/constants.ts'
import type { Document } from 'mongoose'

/**
 * Whether a protected path's current value is unchanged from `original` — a snapshot of what that
 * path held when the document was last hydrated from the database (see the `post('init')` hook in
 * {@link dataProtectionPreSave}).
 *
 * This is what lets an update tell "the exact same already-protected value was reassigned
 * unchanged" (a no-op edit, or a partial update that round-trips other fields) apart from "this
 * path was reassigned a genuinely new value" — without inspecting the value's shape at all (no
 * format/version prefix guessing), so it works identically whether the value is legacy or current,
 * and it's exact rather than a heuristic: two values are either byte-identical or they aren't.
 *
 * Arrays are compared element-by-element (own reference equality would always report "changed"
 * for a fresh array produced by a partial re-assignment, even with identical contents).
 */
export const isProtectionUnchanged = (current: unknown, original: unknown): boolean => {
  if (Array.isArray(current) || Array.isArray(original)) {
    return Array.isArray(current) && Array.isArray(original) &&
      current.length === original.length &&
      current.every((value, index) => value === original[index])
  }
  return current === original
}

/** A protected path containing `*` addresses a per-element path inside an array of subdocuments —
 * not yet supported by `autoProtectOnUpdate`'s detection (see the option's own JSDoc). */
const isWildcardPath = (path: string): boolean => path.includes('*')

/** `'false'` (the literal string) is the only value that disables it — unset, `'true'`, or anything
 * else all enable it. On-by-default, same convention `DATABASE_SEEDERS_ENV` uses elsewhere in this
 * package for an opt-out (rather than opt-in) feature. */
const autoProtectOnUpdateFromEnv = (): boolean =>
  Deno.env.get(AUTO_PROTECT_ON_UPDATE_ENV) !== 'false'

/**
 * Registers a Mongoose pre-save hook that enforces data protection rules.
 *
 * This function inspects the schema’s metadata to find the configured
 * data protection getters. For each protected path, it applies the corresponding
 * transform and executes the data protection getter before the document is saved.
 *
 * In short, it runs all data protection transformations defined in the schema
 * to ensure that sensitive fields are encrypted, masked or sanitized before persistence.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema where the data protection pre-save hook will be applied.
 * @param {boolean} [autoProtectOnUpdate] - The model's `extensions.autoProtectOnUpdate` — whether a
 * document-level update (`.save()` on an existing document) should also auto-protect a reassigned
 * path. Falls back to the `AUTO_PROTECT_ON_DB_UPDATE` env var, then `true`, when omitted — on by
 * default; set the env var to the literal `'false'` (or the option itself to `false`) to opt out.
 * This only ever covers document-level `.save()` — query-level operations (`updateOne`,
 * `findOneAndUpdate`, `bulkWrite`) bypass Mongoose document middleware entirely and are never
 * protected by this, regardless of the setting. See the option's own JSDoc
 * (`database/typings/general.ts`) for the full rationale.
 *
 * @returns {void} Registers the pre-save hook on the schema (no direct return value).
 */
export const dataProtectionPreSave = (
  schema: BaseCustomSchema,
  autoProtectOnUpdate?: boolean,
): void => {
  const dataProtection = schema.statics._getDataProtection()

  if (!schema.statics._hasDataProtection()) return

  const allowedPaths = schema.statics._getDataProtectionPaths()

  // Base data protection transform function
  // `Document` fully loosened: this runs against hydrated documents produced from
  // arbitrary (often default-generic) schemas, whose computed document shape does not
  // structurally match mongoose's own default `Document` (e.g. `_id` may resolve to
  // `unknown` instead of `ObjectId`).
  const tranform = async function async(this: Document<any, any, any, any, any>) {
    await transformShallowByPaths(this, {
      allowedPaths,
      transform: (value, path) => {
        return dataProtectionSetterDefinition(dataProtection[path], value)
      },
    })
  }

  // Pre save native hook (creation)
  schema.pre('save', async function (next) {
    if (!this.isNew) return next()
    await tranform.call(this)
    next()
  })

  if (autoProtectOnUpdate ?? autoProtectOnUpdateFromEnv()) {
    const detectablePaths = allowedPaths.filter((path) => !isWildcardPath(path))

    // Snapshots each protected (non-wildcard) path's as-loaded value right after hydration from a
    // query — the reference point `isProtectionUnchanged` compares against below. Never fires for
    // `new Model(data)` (that's `isNew`, handled by the hook above) — only for documents actually
    // read back from the database, which is exactly the case that needs a "what did this look like
    // before" baseline.
    schema.post('init', function (this: any) {
      this._protectionSnapshot = {}
      for (const path of detectablePaths) {
        const raw = this.get(path, undefined, { getters: false })
        this._protectionSnapshot[path] = Array.isArray(raw) ? [...raw] : raw
      }
    })

    // Pre save native hook (update via `.save()` on an existing document)
    schema.pre('save', async function (this: any, next) {
      if (this.isNew) return next()

      const toProtect: Array<{ path: string; current: any }> = []
      for (const path of detectablePaths) {
        if (!this.isModified(path)) continue // provably unchanged — nothing to decide

        const current = this.get(path, undefined, { getters: false })
        const original = this._protectionSnapshot?.[path]

        if (isProtectionUnchanged(current, original)) continue // same already-protected value, reassigned as-is

        toProtect.push({ path, current })
      }

      await Promise.all(toProtect.map(async ({ path, current }) => {
        this.set(path, await dataProtectionSetterDefinition(dataProtection[path], current))
      }))

      next()
    })
  }

  // upsertById custom hook, defined once
  schema.addListener('upsertWithDataPolicy', async (Model, data, options, next) => {
    await tranform.call(data)
    await schema.statics.upsertById.call(Model, data, options)
    next()
  })

  // upsertManyById custom hook, defined once
  schema.addListener('upsertManyWithDataPolicy', async (Model, data, options, next) => {
    await Promise.all(data.map((ret: Document) => tranform.call(ret)))
    await schema.statics.upsertManyById.call(Model, data, options)
    next()
  })

  // Query-level: updateOne / findOneAndUpdate (this also covers `findByIdAndUpdate`, which
  // Mongoose implements as sugar over `findOneAndUpdate` — same underlying query op, same hook).
  //
  // Opt-in only, via `{ useDataPolicies: true }` in the query options — never automatic, unlike
  // `autoProtectOnUpdate` above. That feature can safely default to on because it has a loaded
  // document to snapshot-diff against (see `isProtectionUnchanged`); here there is no document at
  // all, only a `$set`/`$setOnInsert` payload the caller built themselves — it could be genuine
  // plaintext that needs protecting, or a value the caller already protected by hand (e.g. via
  // `Model.hash()`) before building the update. Only an explicit ask resolves that ambiguity
  // safely; guessing would risk silently double-protecting an already-protected value.
  //
  // `bulkWrite` is deliberately not covered here — Mongoose has no query-middleware hook for it at
  // all (not a limitation of this library); see `processor/schema/statics/bulk-write.ts` for the
  // separate override that covers it instead.
  schema.pre(
    ['updateOne', 'findOneAndUpdate'],
    { document: false, query: true },
    async function (this: any, next) {
      const options = this.getOptions()
      if (!options?.useDataPolicies) return next()

      delete options.useDataPolicies // never forwarded to the MongoDB driver

      const update = this.getUpdate()
      if (!update) return next()

      await Promise.all(
        (['$set', '$setOnInsert'] as const).map((op) => {
          const value = update[op]
          if (!value) return

          return transformShallowByPaths(value, {
            allowedPaths,
            transform: (fieldValue, path) =>
              dataProtectionSetterDefinition(dataProtection[path], fieldValue),
          })
        }),
      )

      next()
    },
  )
}
