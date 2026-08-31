// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals, assertRejects } from '@std/assert'
import { getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { seedManyByIdIfMissing } from 'mongo/utils/seeders.ts'
import { registerModel } from 'modules/database/defs/models.ts'

// Verifies that `upsertManyById`'s bulk path surfaces a client-side cast failure (e.g. an `_id`
// string that can't cast to `ObjectId`) instead of resolving as if it had succeeded with zero
// documents written — which would be indistinguishable from a legitimate no-op.
// `throwOnValidationError: true` makes mongoose throw a `MongooseBulkWriteError` for those cast
// failures, matching what the single-document `upsertById` path already does.

const invalidId1 = 'not-a-valid-object-id'
const invalidId2 = 'also-not-a-valid-object-id'
const validId = '68fb00b33405a3a540d9b981'

Deno.test({
  ...sanitize,
  name: 'upsertManyById rejects instead of silently resolving when every _id fails to cast',
  fn: async () => {
    registerModel({
      name: 'test-upsert-many-cast-all-invalid',
      definition: { name: String },
    })

    const db = await getDB()
    const Model = db.getModel<any>('test-upsert-many-cast-all-invalid')

    await assertRejects(
      () =>
        Model.upsertManyById([
          { id: invalidId1, name: 'A' },
          { id: invalidId2, name: 'B' },
        ]),
    )

    const remaining = await Model.countDocuments({})
    assertEquals(remaining, 0) // nothing was silently written either

    await db['close']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name:
    'upsertManyById writes the validly-cast documents in a mixed batch AND surfaces the cast error',
  fn: async () => {
    registerModel({
      name: 'test-upsert-many-cast-mixed',
      definition: { name: String },
    })

    const db = await getDB()
    const Model = db.getModel<any>('test-upsert-many-cast-mixed')

    await assertRejects(
      async () => {
        await seedManyByIdIfMissing([
          { id: validId, name: 'Valid' },
          { id: invalidId1, name: 'Invalid' },
        ], { useDataPolicies: false })(Model, db)
      },
    )

    const saved = await Model.findById(validId)
    assert(saved) // the valid op in the batch still landed, despite the other op's cast failure
    assertEquals(saved.name, 'Valid')

    await Model.deleteMany({ _id: validId })
    await db['close']()
  },
  ignore,
})
