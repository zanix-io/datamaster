import { assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { LocalSQLite } from 'modules/database/utils/sqlite.ts'

const file = getTemporaryFolder(import.meta.url) + '/' + 'db.sqlite'

Deno.test('constructor initializes DB and table name uppercase', () => {
  const sqlite = new LocalSQLite('users', file)
  assertEquals(sqlite['table'], 'USERS')
})

Deno.test('createTable creates table successfully', () => {
  const sqlite = new LocalSQLite('users', file)

  sqlite.createTable(
    {
      id: 'INTEGER',
      name: 'TEXT',
    },
    { primaryKey: ['id'] },
  )

  // Insert a row to verify table exists
  sqlite['insertOrUpdateData']({ id: 1, name: 'Alice' })

  const result = sqlite.getDataByKey({ id: 1 })

  assertEquals(result, { id: 1, name: 'Alice' })
})

Deno.test('insertOrUpdateData inserts and updates', () => {
  const sqlite = new LocalSQLite('users', file)

  sqlite.createTable({ id: 'INTEGER', name: 'TEXT' }, { primaryKey: ['id'] })

  sqlite.insertOrUpdateData({ id: 1, name: 'Alice' })
  sqlite.insertOrUpdateData({ id: 1, name: 'Bob' })

  const result = sqlite['getDataByKey']({ id: 1 })

  assertEquals(result?.name, 'Bob')
})

Deno.test('getAllData returns all rows', () => {
  const sqlite = new LocalSQLite('users', file)

  sqlite.createTable({ id: 'INTEGER', name: 'TEXT' })

  sqlite.insertOrUpdateData({ id: 1, name: 'A' })
  sqlite.insertOrUpdateData({ id: 2, name: 'B' })

  const rows = sqlite['getAllData']()

  assertEquals(rows.length, 2)
})

Deno.test('deleteByKey deletes rows', () => {
  const sqlite = new LocalSQLite('users', file)

  sqlite.createTable({ id: 'INTEGER', name: 'TEXT' })

  sqlite.insertOrUpdateData({ id: 1, name: 'A' })
  sqlite.insertOrUpdateData({ id: 2, name: 'B' })

  sqlite.deleteByKey({ id: 1 })

  const rows = sqlite['getAllData']()

  assertEquals(rows.length, 1)
  assertEquals(rows[0].id, 2)
})

Deno.test('flush removes all rows', () => {
  const sqlite = new LocalSQLite('users', file)

  sqlite.createTable({ id: 'INTEGER', name: 'TEXT' })

  sqlite.insertOrUpdateData({ id: 1, name: 'A' })
  sqlite.insertOrUpdateData({ id: 2, name: 'B' })

  sqlite.flush()

  const rows = sqlite['getAllData']()

  assertEquals(rows.length, 0)
})
