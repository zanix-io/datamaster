import { assertEquals } from '@std/assert'
import { sanitizeMongoFilter } from 'modules/dlq/filter.ts'

/**
 * Regression coverage for a confirmed risk: `DlqProvider.list()`/`claim()` merged a caller-supplied
 * `filter` straight into a Mongo query with no `$`-operator sanitizer — a filter sourced from an
 * untrusted caller could inject `$where`/`$expr` (arbitrary query-time logic) or a same-named
 * `status`/`$or` key to widen or override the built-in scoping it's merged alongside.
 */

Deno.test('sanitizeMongoFilter: a plain dot-path equality filter passes through unchanged', () => {
  const filter = { 'payload.orderId': 'abc123', 'metadata.tenantId': 'x' }
  assertEquals(sanitizeMongoFilter(filter), filter)
})

Deno.test('sanitizeMongoFilter: strips a top-level $-operator key', () => {
  assertEquals(
    sanitizeMongoFilter({ status: 'pending', $where: 'this.attempts > 999' }),
    { status: 'pending' },
  )
})

Deno.test('sanitizeMongoFilter: strips a $-operator nested inside a field value', () => {
  assertEquals(
    sanitizeMongoFilter({ 'payload.amount': { $gt: 0, $ne: null } }),
    { 'payload.amount': {} },
  )
})

Deno.test('sanitizeMongoFilter: strips a $-operator inside an array of conditions', () => {
  assertEquals(
    sanitizeMongoFilter({ $or: [{ status: 'pending' }, { $where: 'true' }] }),
    {},
  )
})

Deno.test(
  'sanitizeMongoFilter: recurses into an array held under a legitimate (non-$) key',
  () => {
    // Regression coverage for the array-recursion branch itself: the test above only proves a
    // `$`-prefixed key (`$or`) gets dropped wholesale before ever recursing into its array value —
    // it doesn't prove arrays are actually walked, as the class-level doc claims ("plain objects
    // and arrays of objects alike"). A legitimately-named array field forces real recursion.
    assertEquals(
      sanitizeMongoFilter({ tags: [{ ok: 1, $where: 'true' }, { $ne: null }] }),
      { tags: [{ ok: 1 }, {}] },
    )
  },
)

Deno.test('sanitizeMongoFilter: strips $expr and $function specifically', () => {
  assertEquals(
    sanitizeMongoFilter({ $expr: { $gt: ['$attempts', 0] }, $function: {} }),
    {},
  )
})

Deno.test('sanitizeMongoFilter: undefined input returns an empty object', () => {
  assertEquals(sanitizeMongoFilter(undefined), {})
})

Deno.test('sanitizeMongoFilter: a Date value passes through, not walked as an object', () => {
  const when = new Date('2026-01-01')
  assertEquals(sanitizeMongoFilter({ createdAt: when }), { createdAt: when })
})
