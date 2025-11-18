import { assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { ZanixKVStoreConnector } from 'modules/database/providers/sqlite/connector.ts'

const filename = getTemporaryFolder(import.meta.url) + '/' + 'db.sqlite'

Deno.test('ZanixKVConnector: set and get value', () => {
  const kv = new ZanixKVStoreConnector<string>({ filename })
  kv.set('foo', 'bar')
  const value = kv.get('foo')
  assertEquals(value, 'bar')
})

Deno.test('ZanixKVConnector: get non-existent key returns undefined', () => {
  const kv = new ZanixKVStoreConnector({ filename })
  const value = kv.get('missing')
  assertEquals(value, undefined)
})

Deno.test('ZanixKVConnector: delete key', () => {
  const kv = new ZanixKVStoreConnector({ filename })
  kv.set('key1', 'value1')
  kv.delete('key1')
  const value = kv.get('key1')
  assertEquals(value, undefined)
})

Deno.test('ZanixKVConnector: TTL expiration', async () => {
  const kv = new ZanixKVStoreConnector<string>({ filename })
  kv.set('ttlKey', 'temp', 1) // 1 second TTL
  await new Promise((r) => setTimeout(r, 1100))
  const value = kv.get('ttlKey')
  assertEquals(value, undefined)
})

Deno.test('ZanixKVConnector: clear all entries', () => {
  const kv = new ZanixKVStoreConnector({ filename })
  kv.set('a', '1')
  kv.set('b', '2')
  kv.clear()
  assertEquals(kv.get('a'), undefined)
  assertEquals(kv.get('b'), undefined)
})

Deno.test('ZanixKVConnector: withLock ensures exclusive execution', async () => {
  const kv = new ZanixKVStoreConnector<number>({ filename })
  let counter = 0

  await Promise.all([
    kv.withLock('lockKey', async () => {
      counter++
      await new Promise((r) => setTimeout(r, 100))
    }),
    kv.withLock('lockKey', () => {
      counter++
    }),
  ])

  assertEquals(counter, 2)
})
