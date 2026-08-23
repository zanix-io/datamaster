import { assert, assertEquals, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  assertValidMemcachedKey,
  toMemcachedExptime,
} from 'modules/cache/providers/memcached/connector/client.ts'

console.error = () => {}

Deno.test('assertValidMemcachedKey: accepts a normal key', () => {
  assertValidMemcachedKey('user:123')
})

Deno.test('assertValidMemcachedKey: rejects an empty key', () => {
  assertThrows(
    () => assertValidMemcachedKey(''),
    InternalError,
  )
})

Deno.test('assertValidMemcachedKey: rejects a key with a space', () => {
  const error = assertThrows(
    () => assertValidMemcachedKey('bad key'),
    InternalError,
  )
  assertEquals(error.code, 'MEMCACHED_INVALID_KEY')
})

Deno.test(
  'assertValidMemcachedKey: rejects a key containing CRLF (protocol/command injection)',
  () => {
    const error = assertThrows(
      () => assertValidMemcachedKey('key\r\nset injected 0 0 3\r\nabc'),
      InternalError,
    )
    assertEquals(error.code, 'MEMCACHED_INVALID_KEY')
  },
)

Deno.test('assertValidMemcachedKey: rejects a key over 250 bytes', () => {
  assertThrows(
    () => assertValidMemcachedKey('a'.repeat(251)),
    InternalError,
  )
})

Deno.test('assertValidMemcachedKey: accepts a key at exactly 250 bytes', () => {
  assertValidMemcachedKey('a'.repeat(250))
})

Deno.test('toMemcachedExptime: 0 means never expires', () => {
  assertEquals(toMemcachedExptime(0), 0)
})

Deno.test('toMemcachedExptime: negative TTL is treated as never-expires', () => {
  assertEquals(toMemcachedExptime(-5), 0)
})

Deno.test('toMemcachedExptime: a short TTL is sent as a relative offset', () => {
  assertEquals(toMemcachedExptime(60), 60)
})

Deno.test('toMemcachedExptime: a TTL beyond 30 days is converted to an absolute timestamp', () => {
  const ttlSeconds = 60 * 60 * 24 * 31 // 31 days
  const before = Math.floor(Date.now() / 1000)
  const exptime = toMemcachedExptime(ttlSeconds)
  const after = Math.floor(Date.now() / 1000)

  assert(exptime >= before + ttlSeconds)
  assert(exptime <= after + ttlSeconds)
})
