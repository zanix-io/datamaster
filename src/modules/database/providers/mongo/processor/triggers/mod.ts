// deno-lint-ignore-file no-explicit-any
import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { TriggerActions, Triggers } from 'database/typings/triggers.ts'
import { getTriggers, setStaticTriggers } from './registry.ts'
import { handleTrigger } from './dispatch.ts'
import { transformByDataProtection } from '../schema/transforms/data-policies.ts'

const dispatchAll = (
  actions: Array<Partial<TriggerActions>> | undefined,
  data: any,
) => actions?.length ? Promise.all(actions.map((trigger) => handleTrigger(data, trigger))) : null

const dataProtectionTransform = transformByDataProtection({
  excludeHashedFields: true,
  deleteMetadata: true,
})

/**
 * Builds the plain, dispatch-ready snapshot of a hydrated document: reverses data protection
 * (decrypts/unmasks protected paths, drops hashed ones) the same way a client-facing `toJSON` read
 * would, and strips `_id`. Never mutates `doc` itself — the transform is applied to a fresh
 * `toJSON({ getters: false, transform: false })` snapshot, so this is safe to call on a document
 * still being persisted (e.g. `this` inside a `pre('save')` hook), not just on throwaway
 * already-committed fetches.
 *
 * Every value handed to `dispatchAll`/`handleTrigger` (current doc, `_old`, or a deleted document)
 * goes through this, so a trigger — and its `{{field}}` interpolation/`conditions` — always sees
 * the same decrypted/unmasked shape a normal API response would, never raw ciphertext or a hash.
 */
const forDispatch = async (doc: any): Promise<any> => {
  if (!doc) return doc

  const snapshot = doc.toJSON({ getters: false, transform: false })
  await dataProtectionTransform(doc, snapshot)
  delete snapshot._id

  return snapshot
}

/**
 * Registers Mongoose hooks that dispatch configured triggers around a model's create/update/
 * delete lifecycle.
 *
 * Hooks are attached at **both** the document level (`save`, for a single hydrated instance) and
 * the query level (`updateOne`/`findOneAndUpdate`, `deleteOne`/`findOneAndDelete`), since
 * query-level operations bypass document middleware entirely — the same limitation already
 * documented for data protection (see `dataProtectionPreSave`). `pre` actions dispatch in the
 * corresponding pre-hook, `post` actions in the corresponding post-hook, symmetrically across both
 * document- and query-level paths.
 *
 * Every document (current, `_old`, or deleted) handed to a trigger goes through
 * {@link forDispatch} first, consistently across all six paths (document-level `save`, query-level
 * update, query-level delete) — a trigger never sees a protected field's raw encrypted/hashed
 * value, only its decrypted/unmasked (or, for hashed fields, omitted) form.
 *
 * Hooks are wired **unconditionally** (even with no static `triggers` at all) and read the
 * model's current effective triggers via {@link getTriggers} on every invocation, not a snapshot
 * taken here — so triggers loaded later from the persisted triggers collection (see
 * `registerTriggersModel`) take effect without re-registering hooks.
 *
 * Not covered: `insertMany` (bypasses document middleware and isn't a single-document query
 * either) and bulk operations (`bulkWrite`, `updateMany`, `deleteMany`) — same class of gap as
 * data protection's documented limitation.
 *
 * @param schema - The Mongoose schema to attach trigger hooks to.
 * @param modelName - The model's name, used to key the per-model trigger registry.
 * @param connectorKey - The connector this model is bound to (`ZanixConnector.connectorKey`) —
 * scopes the registry lookup/registration to this connector only, captured once here by closure
 * so every hook below reads the right bucket on every invocation.
 * @param triggers - The model's static `extensions.triggers`, registered into the store.
 */
export const triggersMiddleware = (
  schema: BaseCustomSchema,
  modelName: string,
  connectorKey: string,
  triggers?: Triggers,
): void => {
  setStaticTriggers(connectorKey, modelName, triggers)

  const current = () => getTriggers(connectorKey, modelName)
  ;(['created', 'updated'] as const).forEach((event) => {
    const isCreated = event === 'created'

    // Document-level: pre save
    schema.pre('save', async function (this: any, next) {
      const preActions = current()?.pre?.[event]
      let matches: boolean

      if (isCreated) {
        matches = this.isNew
      } else {
        this._old = await forDispatch(
          await this.constructor.findById(this._id),
        )
        matches = !this.isNew
      }
      this._wasNew = this.isNew

      if (matches) {
        const data = await forDispatch(this)
        if (!isCreated) data._old = this._old

        await dispatchAll(preActions, data)
      }

      next()
    })

    // Document-level: post save
    schema.post('save', async function (this: any, doc: any, next) {
      const postActions = current()?.post?.[event]
      const matches = isCreated ? this._wasNew : !this._wasNew
      if (!matches || !postActions?.length) return next()

      // Re-fetched rather than transforming `doc` directly: `doc` is the same live instance the
      // save just went through, and a document-level update (unlike a create) isn't guaranteed to
      // have re-encrypted its protected paths (see `dataProtectionPreSave`'s own `isNew`-only
      // guard) — re-reading what was actually committed keeps this consistent with the query-level
      // paths below, which already dispatch off a fresh fetch. Falls back to the live `doc` on the
      // pathological case where the re-fetch races with a concurrent delete and comes back empty.
      // Only done when there's actually a post action to feed — this is extra work (and, on
      // update, an extra query) on top of the doc- and query-level `pre` hooks below, which already
      // pay for an unconditional fetch of their own regardless of trigger configuration.
      const fresh = await this.constructor.findById(doc._id)
      const data = await forDispatch(fresh ?? doc)
      if (!isCreated) data._old = this._old

      await dispatchAll(postActions, data)

      next()
    })

    if (isCreated) return

    // Query-level: updateOne / findOneAndUpdate
    const updateOptions = { document: false, query: true } as const

    schema.pre(
      ['updateOne', 'findOneAndUpdate'],
      updateOptions,
      async function (this: any, next) {
        const preActions = current()?.pre?.[event]
        if (!preActions?.length) return next()

        this._old = await forDispatch(
          await this.model.findOne(this.getQuery()),
        )

        const { $set, $setOnInsert: _omit, ...rest } = this.getUpdate() ?? {}
        const data = { ...rest, ...$set, _old: this._old }

        await dispatchAll(preActions, data)
        next()
      },
    )

    // Query-level post: `findOneAndUpdate` already returns the updated document; `updateOne`
    // doesn't return one at all, so it's re-fetched the same way — both converge on the same
    // `this._doc` shape (see {@link forDispatch}) for the shared post-dispatch hook below. Skipped
    // entirely when there's no post-updated action to feed, to avoid an unconditional extra
    // `findOne` (plus decrypt) on every query-level update in the app.
    schema.post(
      ['findOneAndUpdate'],
      updateOptions,
      async function (this: any, doc, next) {
        if (!current()?.post?.[event]?.length) return next()
        this._doc = await forDispatch(doc)
        next()
      },
    )

    schema.post(
      ['updateOne'],
      updateOptions,
      async function (this: any, _result, next) {
        if (!current()?.post?.[event]?.length) return next()
        this._doc = await forDispatch(
          await this.model.findOne(this.getQuery()),
        )
        next()
      },
    )

    schema.post(
      ['updateOne', 'findOneAndUpdate'],
      updateOptions,
      async function (this: any, _result, next) {
        const postActions = current()?.post?.[event]
        if (!postActions?.length) return next()

        const { $set, $setOnInsert: _omit, ...rest } = this.getUpdate() ?? {}
        const data = { ...this._doc, ...rest, ...$set, _old: this._old }

        await dispatchAll(postActions, data)
        next()
      },
    )
  })

  // Deletion (document pre-image fetched at query level)
  const stash = '_documentToDelete'
  const deleteOptions = { document: false, query: true } as const

  schema.pre(
    ['deleteOne', 'findOneAndDelete'],
    deleteOptions,
    async function (this: any, next) {
      const preActions = current()?.pre?.deleted
      const document = await forDispatch(
        await this.model.findOne(this.getQuery()),
      )
      this[stash] = document

      if (document) await dispatchAll(preActions, document)

      next()
    },
  )

  schema.post(
    ['deleteOne', 'findOneAndDelete'],
    deleteOptions,
    async function (this: any, _result, next) {
      const postActions = current()?.post?.deleted
      const document = this[stash]

      if (document) await dispatchAll(postActions, document)

      next()
    },
  )
}
