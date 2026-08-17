// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { Schema } from 'mongoose'

Deno.test({
  ...sanitize,
  name: 'getModel binds relatedModels before creating the main model',
  fn: async () => {
    const db = await getDB()

    const relatedSchema = new Schema({ name: String })
    const mainSchema = new Schema({
      related: {
        type: Schema.Types.ObjectId,
        ref: 'test-related-model-inline',
      },
    })

    const Model = db.getModel<any>('test-main-model-inline', mainSchema, {
      relatedModels: {
        'test-related-model-inline': { schema: relatedSchema },
      },
    })

    const RelatedModel = db.getModel<any>('test-related-model-inline')

    const related = await new RelatedModel({ name: 'related name' }).save()
    const main = await new Model({ related: related._id }).save()

    const found = await Model.findById(main._id).populate('related')

    assertEquals(found?.related.name, 'related name')

    await DropCollection(Model, db)
    await DropCollection(RelatedModel, db)
    await db['close']()
  },
  ignore,
})
