/**
 * Module augmentation (no runtime code — types only) that adds `useDataPolicies` to the option
 * shapes Mongoose itself exports and reuses across `findOneAndUpdate` (and therefore
 * `findByIdAndUpdate`, implemented as sugar over it) and `bulkWrite`.
 *
 * Augmenting these shared interfaces — rather than re-declaring every one of Mongoose's own
 * overloaded method signatures on `AdaptedModel` — means the option surfaces automatically after
 * a Mongoose version bump, with nothing in this package to keep in sync.
 *
 * `updateOne` deliberately isn't handled here — its options type is `mongodb.UpdateOptions &
 * MongooseUpdateQueryOptions`, and the latter is a `Pick<QueryOptions, ...>` **type alias** (not an
 * interface) restricted to a fixed key allowlist, so augmenting `QueryOptions` doesn't flow through
 * to it. `mongodb.UpdateOptions` itself resolves to a separate physical module instance from what
 * Mongoose's own bundled types reference internally (confirmed empirically — augmenting it here did
 * not merge), so `updateOne` instead gets an explicit additional overload directly on
 * `AdaptedModel` (`mongo/typings/models.ts`).
 *
 * Purely a compile-time contract: the actual runtime handling lives in
 * `processor/middlewares/data-protection.ts` (the `updateOne`/`findOneAndUpdate` query hook) and
 * `processor/schema/statics/bulk-write.ts` (the `bulkWrite` override) — reading this same option
 * name off `this.getOptions()` / the `options` argument respectively.
 */
declare module 'mongoose' {
  interface QueryOptions<DocType> {
    /**
     * Runs the model's configured data protection (hash/mask/encrypt) over this update's
     * `$set`/`$setOnInsert` payload before it executes — opt-in, mirrors `upsertById`'s own
     * `useDataPolicies` flag. `false`/unset by default: unlike `autoProtectOnUpdate`, there's no
     * loaded document here to tell a genuine plaintext value apart from an already-protected one
     * carried through, so this never runs unless explicitly asked for.
     *
     * @default false
     */
    useDataPolicies?: boolean
  }

  interface MongooseBulkWriteOptions {
    /**
     * Runs the model's configured data protection (hash/mask/encrypt) over each operation's write
     * payload (`updateOne`/`updateMany`'s `$set`/`$setOnInsert`, `insertOne`'s `document`,
     * `replaceOne`'s `replacement`) before the batch executes. Same semantics as `QueryOptions`'s
     * `useDataPolicies` above, extended to `bulkWrite` — see `bulk-write.ts` for why `bulkWrite`
     * needs its own static override rather than a query-middleware hook.
     *
     * @default false
     */
    useDataPolicies?: boolean
  }
}

export {}
