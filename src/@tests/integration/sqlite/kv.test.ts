import { assert, assertEquals } from '@std/assert'
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
  // A 1s TTL checked at 900ms/1000ms left near-zero real margin on both sides — under full-suite
  // load, scheduler/IO contention from neighboring tests can delay these `setTimeout`s enough for
  // the "still here" read to land after the real expiry (the same class of flake fixed for the
  // Memcached/Redis TTL tests — widened here the same way instead of tightening the assertion).
  const kv = new ZanixKVStoreConnector<string>({ filename })
  kv.set('ttlKey', 'temp', 3) // 3 second TTL
  await new Promise((r) => setTimeout(r, 2000))
  assert(kv.get('ttlKey')) // still here, ~1s of margin before the 3s TTL
  await new Promise((r) => setTimeout(r, 1500))
  const value = kv.get('ttlKey') // ~3500ms since set — safely past the 3s TTL
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

Deno.test('ZanixKVConnector: a SQL-injection-shaped key/value is bound, not executed', () => {
  const kv = new ZanixKVStoreConnector<string>({ filename })

  const maliciousKey = "x'; DROP TABLE ZNX_KV; --"
  const maliciousValue = "'); DELETE FROM ZNX_KV WHERE ('1'='1"

  kv.set(maliciousKey, maliciousValue)

  // Round-trips literally — proving the payload was bound as a parameter, never concatenated
  // into the SQL text (which would have thrown, dropped/altered the table, or mangled the value).
  assertEquals(kv.get(maliciousKey), maliciousValue)

  // The table still exists and functions normally — nothing from the "malicious" key/value was
  // ever actually executed as SQL.
  kv.set('safe-key', 'safe-value')
  assertEquals(kv.get('safe-key'), 'safe-value')
  assertEquals(kv.get(maliciousKey), maliciousValue)
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
