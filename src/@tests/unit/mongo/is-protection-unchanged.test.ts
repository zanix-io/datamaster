import { assertEquals } from '@std/assert'
import { isProtectionUnchanged } from 'mongo/processor/middlewares/data-protection.ts'

Deno.test('isProtectionUnchanged: identical scalars are unchanged', () => {
  assertEquals(isProtectionUnchanged('v0:abc', 'v0:abc'), true)
})

Deno.test('isProtectionUnchanged: different scalars are changed', () => {
  assertEquals(isProtectionUnchanged('v0:abc', 'v0:xyz'), false)
})

Deno.test('isProtectionUnchanged: undefined vs undefined is unchanged', () => {
  assertEquals(isProtectionUnchanged(undefined, undefined), true)
})

Deno.test('isProtectionUnchanged: a value replacing undefined is changed', () => {
  assertEquals(isProtectionUnchanged('new-value', undefined), false)
})

Deno.test('isProtectionUnchanged: identical arrays (same order) are unchanged', () => {
  assertEquals(isProtectionUnchanged(['a', 'b'], ['a', 'b']), true)
})

Deno.test('isProtectionUnchanged: arrays with different content are changed', () => {
  assertEquals(isProtectionUnchanged(['a', 'b'], ['a', 'c']), false)
})

Deno.test('isProtectionUnchanged: arrays of different length are changed', () => {
  assertEquals(isProtectionUnchanged(['a'], ['a', 'b']), false)
})

Deno.test('isProtectionUnchanged: two empty arrays are unchanged', () => {
  assertEquals(isProtectionUnchanged([], []), true)
})

Deno.test('isProtectionUnchanged: a fresh array with identical content is unchanged', () => {
  // Guards against reference-equality mistakes — a partial re-assignment always produces a new
  // array object even when nothing in it actually differs.
  assertEquals(isProtectionUnchanged([...['a', 'b']], ['a', 'b']), true)
})

Deno.test('isProtectionUnchanged: an array compared against a non-array is changed', () => {
  assertEquals(isProtectionUnchanged(['a'], 'a'), false)
  assertEquals(isProtectionUnchanged('a', ['a']), false)
})
