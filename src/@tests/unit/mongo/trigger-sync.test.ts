import { assertEquals } from '@std/assert'
import { deepEqual, planTriggerSync } from 'mongo/processor/triggers/sync.ts'

Deno.test('deepEqual treats identical primitives and structures as equal', () => {
  assertEquals(deepEqual(1, 1), true)
  assertEquals(deepEqual('a', 'a'), true)
  assertEquals(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true)
})

Deno.test('deepEqual detects differing primitives, array lengths, and object keys', () => {
  assertEquals(deepEqual(1, 2), false)
  assertEquals(deepEqual([1, 2], [1, 2, 3]), false)
  assertEquals(deepEqual({ a: 1 }, { a: 1, b: 2 }), false)
  assertEquals(deepEqual({ a: 1 }, { b: 1 }), false)
})

Deno.test('deepEqual treats null and undefined as distinct from each other and objects', () => {
  assertEquals(deepEqual(null, undefined), false)
  assertEquals(deepEqual(null, {}), false)
  assertEquals(deepEqual(undefined, undefined), true)
})

Deno.test('planTriggerSync seeds a model with static triggers and no persisted entry', () => {
  const triggers = { post: { created: [{ custom: { name: 'x' } }] } }
  const plan = planTriggerSync([['users', triggers]], [])

  assertEquals(plan.toSeed, [{ model: 'users', triggers }])
  assertEquals(plan.toDelete, [])
  assertEquals(plan.toResync, [])
})

Deno.test('planTriggerSync deletes a default entry whose model has no static triggers', () => {
  const plan = planTriggerSync([], [
    {
      _id: 'id-1',
      model: 'orphaned',
      isDefault: true,
      triggers: { post: { created: [{ custom: { name: 'old' } }] } },
      lastSyncedTriggers: { post: { created: [{ custom: { name: 'old' } }] } },
    },
  ])

  assertEquals(plan.toDelete, ['id-1'])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toSeed, [])
})

Deno.test('planTriggerSync re-syncs an untouched default entry when code changed', () => {
  const oldTriggers = { post: { created: [{ custom: { name: 'old' } }] } }
  const newTriggers = { post: { created: [{ custom: { name: 'new' } }] } }

  const plan = planTriggerSync([['users', newTriggers]], [
    {
      _id: 'id-1',
      model: 'users',
      isDefault: true,
      triggers: oldTriggers,
      lastSyncedTriggers: oldTriggers,
    },
  ])

  assertEquals(plan.toResync, [{ _id: 'id-1', triggers: newTriggers }])
  assertEquals(plan.toDelete, [])
  assertEquals(plan.toSeed, [])
})

Deno.test('planTriggerSync leaves a manually-edited entry untouched despite a code change', () => {
  const seededTriggers = { post: { created: [{ custom: { name: 'seeded' } }] } }
  const editedTriggers = { post: { created: [{ custom: { name: 'edited-by-hand' } }] } }
  const newCodeTriggers = { post: { created: [{ custom: { name: 'new-code' } }] } }

  const plan = planTriggerSync([['users', newCodeTriggers]], [
    {
      _id: 'id-1',
      model: 'users',
      isDefault: true,
      triggers: editedTriggers,
      lastSyncedTriggers: seededTriggers,
    },
  ])

  assertEquals(plan.toResync, [])
  assertEquals(plan.toDelete, [])
  assertEquals(plan.toSeed, [])
})

Deno.test('planTriggerSync does nothing for an untouched default entry with unchanged code', () => {
  const triggers = { post: { created: [{ custom: { name: 'same' } }] } }

  const plan = planTriggerSync([['users', triggers]], [
    { _id: 'id-1', model: 'users', isDefault: true, triggers, lastSyncedTriggers: triggers },
  ])

  assertEquals(plan.toResync, [])
  assertEquals(plan.toDelete, [])
  assertEquals(plan.toSeed, [])
})

Deno.test('planTriggerSync never touches non-default entries', () => {
  const plan = planTriggerSync([], [
    {
      _id: 'id-1',
      model: 'custom-only',
      isDefault: false,
      triggers: { post: { created: [{ custom: { name: 'manual' } }] } },
    },
  ])

  assertEquals(plan.toDelete, [])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toSeed, [])
})
