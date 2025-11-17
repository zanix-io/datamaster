import { assert, assertEquals, assertFalse, assertStrictEquals } from '@std/assert'
import { ZanixQLRUConnector } from 'modules/cache/providers/qlru/connector.ts'

Deno.test('QuickLRU: works with string keys and object values', () => {
  interface User {
    id: number
    name: string
  }

  const cache = new ZanixQLRUConnector<string, User>({ capacity: 3 })

  const user1 = { id: 1, name: 'Alice' }
  const user2 = { id: 2, name: 'Bob' }

  cache.set('u1', user1)
  cache.set('u2', user2)

  const result = cache.get('u1')
  assertEquals(result, user1)
  assertEquals(result?.name, 'Alice')
})

Deno.test('QuickLRU: shoud work on backround setting', async () => {
  const cache = new ZanixQLRUConnector<string, number>({ capacity: 3 })

  cache.clear()

  const key = 'schedule-key'

  cache.set(key, 1, { exp: 0.4, schedule: true })

  const value = cache.get(key)
  assertFalse(value) // shoud not exist

  // wait 50ms to wait to save on background
  await new Promise((resolve) => setTimeout(resolve, 50))

  const savedValue = cache.get(key)
  assert(savedValue)

  cache.clear()
})

Deno.test('QuickLRU: works with number keys and string values', () => {
  const cache = new ZanixQLRUConnector<number, string>({ capacity: 2 })

  cache.set(1, 'uno')
  cache.set(2, 'dos')

  assertStrictEquals(cache.get(1), 'uno')
  assertStrictEquals(cache.get(2), 'dos')

  // Trigger LRU eviction
  cache.set(3, 'tres')
  assertFalse(cache.has(1)) // 1 was least recently used
})

Deno.test('QuickLRU: works with object keys', () => {
  const cache = new ZanixQLRUConnector<object, string>({ capacity: 2 })

  const key1 = { id: 1 }
  const key2 = { id: 2 }

  cache.set(key1, 'A')
  cache.set(key2, 'B')

  assertStrictEquals(cache.get(key1), 'A')
  assertStrictEquals(cache.get(key2), 'B')

  // New object with same structure ≠ same reference
  assertEquals(cache.get({ id: 1 }), undefined)
})

Deno.test('QuickLRU: works with array keys and values', () => {
  const cache = new ZanixQLRUConnector<number[], string[]>({ capacity: 2 })

  const key = [1, 2]
  const value = ['a', 'b']

  cache.set(key, value)
  const result = cache.get(key)

  assertEquals(result, ['a', 'b'])
  assert(result !== undefined)
})

Deno.test('QuickLRU: works with mixed types (string, object, array, number)', () => {
  // deno-lint-ignore no-explicit-any
  const cache = new ZanixQLRUConnector<any, any>({ capacity: 4 })

  cache.set('x', 123)
  cache.set(42, 'answer')
  cache.set({ id: 1 }, [1, 2, 3])
  cache.set(['arr'], { foo: 'bar' })

  assertEquals(cache.size(), 4)
})

Deno.test('QuickLRU: complex nested objects as values', () => {
  // deno-lint-ignore no-explicit-any
  const cache = new ZanixQLRUConnector<string, Record<string, any>>({ capacity: 2 })

  const data = {
    user: { id: 1, profile: { age: 30, name: 'Alice' } },
    permissions: ['read', 'write'],
  }

  cache.set('session1', data)
  const result = cache.get('session1')

  assertEquals(result, data)
  assertEquals(result?.user.profile.name, 'Alice')
})

Deno.test('QuickLRU: can store functions as values', () => {
  const cache = new ZanixQLRUConnector<string, () => string>({ capacity: 2 })

  cache.set('greet', () => 'Hello')
  cache.set('bye', () => 'Goodbye')

  const greetFn = cache.get('greet')
  assert(greetFn)
  assertStrictEquals(greetFn?.(), 'Hello')
})
