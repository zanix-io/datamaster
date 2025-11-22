import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import { ZanixQLRUConnector } from 'modules/cache/providers/qlru/connector.ts'

console.error = () => {}

Deno.test('QuickLRU: basic set and get', () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)

  assertStrictEquals(cache.get('a'), 1)
  assertStrictEquals(cache.get('b'), 2)
  assertStrictEquals(cache.get('c'), 3)
})

Deno.test('QuickLRU: evicts least recently used item when full', () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)

  // Access 'a' to make it most recently used
  cache.get('a')

  // Insert new item, should evict 'b'
  cache.set('d', 4)

  assert(cache.has('a'))
  assert(cache.has('c'))
  assert(cache.has('d'))
  assertFalse(cache.has('b'))
})

Deno.test('QuickLRU: updates existing key and moves it to most recent', () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 2 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('a', 10) // Update 'a', should become most recent

  cache.set('c', 3) // Evict least recent ('b')

  assert(cache.has('a'))
  assert(cache.has('c'))
  assertFalse(cache.has('b'))
  assertStrictEquals(cache.get('a'), 10)
})

Deno.test('QuickLRU: respects TTL expiration', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 3,
  })
  cache.set('x', 42, { exp: 0.1 }) // 100 ms TTL
  assertStrictEquals(cache.get('x'), 42)

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert(cache.get('x')) // still here

  // Wait until item expires
  await new Promise((resolve) => setTimeout(resolve, 150))
  assertEquals(cache.get('x'), undefined)
  assertFalse(cache.has('x'))
})

Deno.test('QuickLRU: does not expire items when TTL is 0', async () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 2 })
  cache.set('a', 1)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assertStrictEquals(cache.get('a'), 1)
})

Deno.test('QuickLRU: clear() removes all items', () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.clear()

  assertEquals(cache.size(), 0)
  assertFalse(cache.has('a'))
})

Deno.test('QuickLRU: delete() removes specific item', () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  const result = cache.delete('a')

  assert(result)
  assertFalse(cache.has('a'))
  assertEquals(cache.size(), 1)
})

Deno.test('QuickLRU: size() evicts expired items', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 3,
    ttl: 0.1,
    maxTTLOffset: 0.001,
    minTTLForOffset: 0,
  })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  await new Promise((r) => setTimeout(r, 150))

  assertEquals(cache.size(), 0)
})

Deno.test('QuickLRU: keys() returns valid non-expired keys', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 3,
    ttl: 0.1,
    maxTTLOffset: 0.001,
    minTTLForOffset: 0,
  })
  cache.set('a', 1)
  cache.set('b', 2)

  const keysBefore = cache.keys()
  assertEquals(keysBefore.sort(), ['a', 'b'])

  await new Promise((r) => setTimeout(r, 150))
  assertEquals(cache.keys(), [])
})

Deno.test('QuickLRU: values() returns valid non-expired values', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 3,
    ttl: 0.1,
    maxTTLOffset: 0.001,
    minTTLForOffset: 0,
  })
  cache.set('a', 1)
  cache.set('b', 2)

  const valuesBefore = cache.values()
  assertEquals(valuesBefore.sort(), [1, 2])

  await new Promise((r) => setTimeout(r, 150))
  assertEquals(cache.values(), [])
})

Deno.test('QuickLRU: overwriting key resets TTL', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 2,
    ttl: 0.1,
    maxTTLOffset: 0.001,
    minTTLForOffset: 0,
  })
  cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 80))
  cache.set('x', 20) // Reset TTL

  await new Promise((r) => setTimeout(r, 80)) // Now 160ms since first write, but <100ms since overwrite

  assertEquals(cache.get('x'), 20) // Still valid
})

Deno.test('QuickLRU: overwriting key dont resets TTL if KEEP', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 2,
    ttl: 1,
  })
  cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 800))
  cache.set('x', 20, { exp: 'KEEPTTL' }) // KEEP TTL

  await new Promise((r) => setTimeout(r, 150)) // Now 950ms since first write

  assertEquals(cache.get('x'), 20) // Still valid

  await new Promise((r) => setTimeout(r, 200)) // Now 1100ms since first write

  assertFalse(cache.has('x'))
})

Deno.test('QuickLRU: with custom TTL', async () => {
  const cache = new ZanixQLRUConnector<string, number>({
    capacity: 2,
    ttl: 0.1,
    maxTTLOffset: 0.001,
    minTTLForOffset: 0,
  })
  cache.set('x', 10)

  await new Promise((r) => setTimeout(r, 80))
  cache.set('x', 20, { exp: 0.07 }) // Reset TTL with custom TTL value

  await new Promise((r) => setTimeout(r, 60)) // Now 160ms since first write

  assert(cache.has('x'))

  await new Promise((r) => setTimeout(r, 80)) // Now 160ms since first write, but <100ms since overwrite

  assertFalse(cache.has('x'))
})

Deno.test('QuickLRU: throws error if capacity <= 0', () => {
  let threw = false
  try {
    new ZanixQLRUConnector<string, number>({ capacity: 0 })
  } catch {
    threw = true
  }
  assert(threw)
})
