// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { MONGO_DB_NAME_ENV, ZanixMongoConnector } from 'mongo/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}

/** Builds a connector with `MONGO_DB_NAME` set to `value` (unset when `undefined`) and reports the
 * database name it resolved, without connecting. */
async function resolvedDbName(
  value: string | undefined,
  config?: { dbName?: string },
): Promise<string> {
  const previous = Deno.env.get(MONGO_DB_NAME_ENV)
  if (value === undefined) Deno.env.delete(MONGO_DB_NAME_ENV)
  else Deno.env.set(MONGO_DB_NAME_ENV, value)
  try {
    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: false, config }) as any
    const name = db.dbName as string
    await db['close']()
    return name
  } finally {
    if (previous === undefined) Deno.env.delete(MONGO_DB_NAME_ENV)
    else Deno.env.set(MONGO_DB_NAME_ENV, previous)
  }
}

Deno.test('dbName falls back to MONGO_DB_NAME when omitted', async () => {
  assertEquals(await resolvedDbName('staff_iam'), 'staff_iam')
})

Deno.test('the config.dbName option wins over MONGO_DB_NAME', async () => {
  assertEquals(await resolvedDbName('from_env', { dbName: 'from_option' }), 'from_option')
})

Deno.test('with neither, dbName is the default derived from the project name', async () => {
  const name = await resolvedDbName(undefined)
  assertEquals(typeof name, 'string')
  assertEquals(name.length > 0, true)
  assertEquals(name === 'staff_iam', false)
})

Deno.test('an empty MONGO_DB_NAME counts as unset', async () => {
  assertEquals(await resolvedDbName(''), await resolvedDbName(undefined))
})
