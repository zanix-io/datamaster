// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { assertEquals, assertThrows } from '@std/assert'
import { Schema } from 'mongoose'

console.error = () => {}

const newSchema = () =>
  new Schema({
    name: String,
    status: String,
    taxId: {
      type: String,
      get: dataProtectionGetter('mask'),
    },
    ssn: {
      type: String,
      get: dataProtectionGetter('hash'),
    },
  })

Deno.test({
  ...sanitize,
  name: 'buildSearchFilter: an unprotected field gets a plain case-insensitive $regex',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-search-plain-field', newSchema())

    await new Model({ name: 'Acme Corp' }).save()
    await new Model({ name: 'Other Inc' }).save()

    const filter = Model.buildSearchFilter('acme', ['name'])
    const docs = await Model.find(filter)

    assertEquals(docs.length, 1)
    assertEquals(docs[0].name, 'Acme Corp')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'buildSearchFilter: a mask-protected field is masked before building the $regex',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-search-masked-field', newSchema())

    await new Model({ name: 'Acme Corp', taxId: '123456789' }).save()
    await new Model({ name: 'Other Inc', taxId: '987654321' }).save()

    const filter = Model.buildSearchFilter('123456', ['taxId'])
    const docs = await Model.find(filter)

    assertEquals(docs.length, 1)
    const masked: any = docs[0].taxId
    assertEquals(masked?.unmask?.(), '123456789')

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'buildSearchFilter: searches across multiple fields with $or, mixing plain and masked ones',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-search-multi-field', newSchema())

    await new Model({ name: 'findable-by-name', taxId: '111' }).save()
    // A masked field only matches as a *prefix* — masking is position-keyed, so the term must start
    // at index 0 of the plaintext (see `buildSearchFilter`'s own JSDoc).
    await new Model({ name: 'nope', taxId: 'findable-by-tax' }).save()
    await new Model({ name: 'nope-either', taxId: '333' }).save()

    const filter = Model.buildSearchFilter('findable', ['name', 'taxId'])
    const docs = await Model.find(filter)

    assertEquals(docs.length, 2)

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    "buildSearchFilter: a masked field only matches as a prefix — a term occurring mid-value doesn't match",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-search-masked-mid-value', newSchema())

    await new Model({ name: 'irrelevant', taxId: '222-findable-by-tax' })
      .save()

    const filter = Model.buildSearchFilter('findable', ['taxId'])
    const docs = await Model.find(filter)

    assertEquals(docs.length, 0)

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'buildSearchFilter: merges direct-match conditions alongside the $or',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-search-conditions', newSchema())

    await new Model({ name: 'Acme Corp', status: 'active' }).save()
    await new Model({ name: 'Acme Branch', status: 'inactive' }).save()

    const filter = Model.buildSearchFilter('acme', ['name'], {
      status: 'active',
    })
    const docs = await Model.find(filter)

    assertEquals(docs.length, 1)
    assertEquals(docs[0].name, 'Acme Corp')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'buildSearchFilter: a falsy query returns only the direct-match conditions, no $or',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-search-empty-query', newSchema())

    assertEquals(
      Model.buildSearchFilter(undefined, ['name'], { status: 'active' }),
      {
        status: 'active',
      },
    )
    assertEquals(Model.buildSearchFilter('', ['name']), {})

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    "buildSearchFilter: throws for a search field protected with 'hash' (no substring match possible)",
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const db = await getDB()
    const Model = db.getModel('test-search-hash-field', newSchema())

    assertThrows(() => Model.buildSearchFilter('123', ['ssn']))

    Deno.env.delete('DATA_SECRET_KEY')
    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name:
    'buildSearchFilter: a regex special character in the query is matched literally, not as a pattern',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-search-regex-escape', newSchema())

    await new Model({ name: 'a.b' }).save()
    await new Model({ name: 'axb' }).save() // would also match `a.b` if '.' were left unescaped

    const filter = Model.buildSearchFilter('a.b', ['name'])
    const docs = await Model.find(filter)

    assertEquals(docs.length, 1)
    assertEquals(docs[0].name, 'a.b')

    await DropCollection(Model, db)
    await db['close']()
  },
})

Deno.test({
  ...sanitize,
  name: 'paginate: search integrates end-to-end with buildSearchFilter and a direct-match filter',
  fn: async () => {
    const db = await getDB()
    const Model = db.getModel('test-search-paginate-e2e', newSchema())

    await new Model({ name: 'Acme Corp', status: 'active' }).save()
    await new Model({ name: 'Acme Branch', status: 'inactive' }).save()
    await new Model({ name: 'Other Inc', status: 'active' }).save()

    const { docs, total } = await Model.paginate({
      filter: { status: 'active' },
      search: { query: 'acme', fields: ['name'] },
    })

    assertEquals(total, 1)
    assertEquals(docs.length, 1)
    assertEquals(docs[0].name, 'Acme Corp')

    await DropCollection(Model, db)
    await db['close']()
  },
})
