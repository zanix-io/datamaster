import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'
import { createDatabase } from 'mongo/processor/mod.ts'

Deno.test('createDatabase: "db:name" model routes to useDb and full-key registration', () => {
  const database = createDatabase()
  const schema = new Schema({ value: String })

  const calledWith: string[] = []
  const originalUseDb = database.connection.useDb.bind(database.connection)
  database.connection.useDb = ((name: string, options?: unknown) => {
    calledWith.push(name)
    return originalUseDb(name, options as never)
  }) as typeof database.connection.useDb

  const model = database.model('otherDb:widgets', schema)

  assertEquals(calledWith, ['otherDb'])
  assertEquals(model.modelName, 'otherDb:widgets')
  assertEquals(database.models['otherDb:widgets'], model)
  assertEquals(model.db.name, 'otherDb')
})

Deno.test('createDatabase: plain model name (no ":") skips useDb, default Mongoose path', () => {
  const database = createDatabase()
  const schema = new Schema({ value: String })

  const calledWith: string[] = []
  const originalUseDb = database.connection.useDb.bind(database.connection)
  database.connection.useDb = ((name: string, options?: unknown) => {
    calledWith.push(name)
    return originalUseDb(name, options as never)
  }) as typeof database.connection.useDb

  const model = database.model('widgets', schema)

  assertEquals(calledWith, [])
  assertEquals(model.modelName, 'widgets')
  assert(database.models['widgets'])
})
