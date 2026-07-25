// deno-lint-ignore-file no-explicit-any
import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { TriggerActions, Triggers } from 'database/typings/triggers.ts'
import { getTriggers, setStaticTriggers } from './registry.ts'
import { handleTrigger } from './dispatch.ts'

const dispatchAll = (
  actions: Array<Partial<TriggerActions>> | undefined,
  data: any,
) => actions?.length ? Promise.all(actions.map((trigger) => handleTrigger(data, trigger))) : null

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
 * @param triggers - The model's static `extensions.triggers`, registered into the store.
 */
export const triggersMiddleware = (
  schema: BaseCustomSchema,
  modelName: string,
  triggers?: Triggers,
): void => {
  setStaticTriggers(modelName, triggers)

  const current = () => getTriggers(modelName)
  ;(['created', 'updated'] as const).forEach((event) => {
    const isCreated = event === 'created'

    // Document-level: pre save
    schema.pre('save', async function (this: any, next) {
      const preActions = current()?.pre?.[event]
      let matches: boolean

      if (isCreated) {
        matches = this.isNew
      } else {
        this._old = await this.constructor.findById(this._id)
        matches = !this.isNew
      }
      this._wasNew = this.isNew

      if (matches) await dispatchAll(preActions, this)

      next()
    })

    // Document-level: post save
    schema.post('save', async function (this: any, doc: any, next) {
      const postActions = current()?.post?.[event]
      const matches = isCreated ? this._wasNew : !this._wasNew
      if (!matches) return next()

      if (!isCreated) doc._old = this._old
      await dispatchAll(postActions, doc)

      next()
    })

    if (isCreated) return

    // Query-level: updateOne / findOneAndUpdate
    const updateOptions = { document: false, query: true } as const

    schema.pre(['updateOne', 'findOneAndUpdate'], updateOptions, async function (this: any, next) {
      const preActions = current()?.pre?.[event]
      if (!preActions?.length) return next()

      const old = await this.model.findOne(this.getQuery())
      this._old = old

      const { $set, $setOnInsert: _omit, ...rest } = this.getUpdate() ?? {}
      const data = { ...rest, ...$set, _old: old }

      await dispatchAll(preActions, data)
      next()
    })

    schema.post(
      ['updateOne', 'findOneAndUpdate'],
      updateOptions,
      async function (this: any, _result, next) {
        const postActions = current()?.post?.[event]
        if (!postActions?.length) return next()

        const { $set, $setOnInsert: _omit, ...rest } = this.getUpdate() ?? {}
        const data = { ...rest, ...$set, _old: this._old }

        await dispatchAll(postActions, data)
        next()
      },
    )
  })

  // Deletion (document pre-image fetched at query level)
  const stash = '_documentToDelete'
  const deleteOptions = { document: false, query: true } as const

  schema.pre(['deleteOne', 'findOneAndDelete'], deleteOptions, async function (this: any, next) {
    const preActions = current()?.pre?.deleted
    const document = await this.model.findOne(this.getQuery())
    this[stash] = document

    if (document) await dispatchAll(preActions, document)

    next()
  })

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
