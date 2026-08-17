import { assertEquals, assertThrows } from '@std/assert'
import { validateConditions } from 'mongo/processor/triggers/conditions.ts'

console.error = () => {}

Deno.test('validateConditions returns true for an empty condition set', () => {
  assertEquals(validateConditions({ bool: true }, []), true)
})

Deno.test('validateConditions evaluates "=" correctly', () => {
  assertEquals(
    validateConditions({ bool: true }, [{
      field: 'bool',
      op: '=',
      value: true,
    }]),
    true,
  )
  assertEquals(
    validateConditions({ bool: false }, [{
      field: 'bool',
      op: '=',
      value: true,
    }]),
    false,
  )
})

Deno.test('validateConditions evaluates "!=" correctly', () => {
  assertEquals(
    validateConditions({ num: 3 }, [{ field: 'num', op: '!=', value: 4 }]),
    true,
  )
  assertEquals(
    validateConditions({ num: 4 }, [{ field: 'num', op: '!=', value: 4 }]),
    false,
  )
})

Deno.test('validateConditions evaluates numeric comparisons', () => {
  assertEquals(
    validateConditions({ num: 5 }, [{ field: 'num', op: '<', value: 10 }]),
    true,
  )
  assertEquals(
    validateConditions({ num: 5 }, [{ field: 'num', op: '>', value: 10 }]),
    false,
  )
  assertEquals(
    validateConditions({ num: 5 }, [{ field: 'num', op: '<=', value: 5 }]),
    true,
  )
  assertEquals(
    validateConditions({ num: 5 }, [{ field: 'num', op: '>=', value: 5 }]),
    true,
  )
})

Deno.test('validateConditions evaluates "includes" against an array field', () => {
  assertEquals(
    validateConditions({ tags: ['a', 'b'] }, [{
      field: 'tags',
      op: 'includes',
      value: 'a',
    }]),
    true,
  )
  assertEquals(
    validateConditions({ tags: ['a', 'b'] }, [{
      field: 'tags',
      op: 'includes',
      value: 'c',
    }]),
    false,
  )
})

Deno.test('validateConditions requires every condition in the set to pass (implicit AND)', () => {
  const conditions = [
    { field: 'num', op: '>' as const, value: 1 },
    { field: 'bool', op: '=' as const, value: true },
  ]
  assertEquals(validateConditions({ num: 5, bool: true }, conditions), true)
  assertEquals(validateConditions({ num: 5, bool: false }, conditions), false)
})

Deno.test('validateConditions evaluates a nested "and" group', () => {
  const conditions = [{
    and: [
      { field: 'num', op: '>' as const, value: 1 },
      { field: 'num', op: '<' as const, value: 10 },
    ],
  }]
  assertEquals(validateConditions({ num: 5 }, conditions), true)
  assertEquals(validateConditions({ num: 20 }, conditions), false)
})

Deno.test('validateConditions evaluates a nested "or" group', () => {
  const conditions = [{
    or: [
      { field: 'bool', op: '=' as const, value: true },
      { field: 'bool', op: '=' as const, value: '!$undefined' as const },
    ],
  }]
  assertEquals(validateConditions({ bool: true }, conditions), true)
  assertEquals(validateConditions({}, conditions), true)
  assertEquals(validateConditions({ bool: false }, conditions), false)
})

Deno.test('validateConditions evaluates a "not" group', () => {
  const conditions = [{
    not: [{ field: 'bool', op: '=' as const, value: true }],
  }]
  assertEquals(validateConditions({ bool: false }, conditions), true)
  assertEquals(validateConditions({ bool: true }, conditions), false)
})

Deno.test('validateConditions "!$undefined" sentinel compares a field against undefined', () => {
  assertEquals(
    validateConditions({}, [{ field: 'bool', op: '=', value: '!$undefined' }]),
    true,
  )
  assertEquals(
    validateConditions({ bool: false }, [{
      field: 'bool',
      op: '=',
      value: '!$undefined',
    }]),
    false,
  )
})

Deno.test('validateConditions "$field" prefix compares against another field', () => {
  assertEquals(
    validateConditions({ startDate: 1, endDate: 2 }, [
      { field: 'startDate', op: '<', value: '$endDate' },
    ]),
    true,
  )
  assertEquals(
    validateConditions({ startDate: 5, endDate: 2 }, [
      { field: 'startDate', op: '<', value: '$endDate' },
    ]),
    false,
  )
})

Deno.test('validateConditions throws on an unsupported operator', () => {
  assertThrows(() =>
    validateConditions({ num: 1 }, [
      { field: 'num', op: 'unsupported' as never, value: 1 },
    ])
  )
})

Deno.test('validateConditions throws on an invalid condition shape', () => {
  assertThrows(() => validateConditions({}, [{ nope: true } as never]))
})
