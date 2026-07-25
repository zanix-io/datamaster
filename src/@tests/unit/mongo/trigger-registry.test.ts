import { assertEquals } from '@std/assert'
import {
  getStaticTriggerEntries,
  getTriggers,
  mergeTriggers,
  resetPersistedTriggers,
  setDefaultSuppressed,
  setPersistedTriggers,
  setStaticTriggers,
} from 'mongo/processor/triggers/registry.ts'

Deno.test('mergeTriggers concatenates action arrays per timing x event', () => {
  const base = { post: { created: [{ custom: { name: 'a' } }] } }
  const extra = {
    post: { created: [{ custom: { name: 'b' } }] },
    pre: { deleted: [{ custom: { name: 'c' } }] },
  }

  const merged = mergeTriggers(base, extra)

  assertEquals(merged.post?.created?.map((a) => (a.custom as { name: string }).name), ['a', 'b'])
  assertEquals(merged.pre?.deleted?.map((a) => (a.custom as { name: string }).name), ['c'])
})

Deno.test('mergeTriggers omits empty timing/event slots', () => {
  const merged = mergeTriggers({}, {})
  assertEquals(merged, {})
})

Deno.test("setStaticTriggers registers a model's static triggers", () => {
  const triggers = { post: { created: [{ custom: { name: 'x' } }] } }
  setStaticTriggers('registry-test-model-a', triggers)

  assertEquals(getTriggers('registry-test-model-a'), triggers)
})

Deno.test('getTriggers combines the static and persisted layers', () => {
  setStaticTriggers(
    'registry-test-model-b',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    'registry-test-model-b',
    { post: { created: [{ custom: { name: 'from-db' } }] } },
  )

  const result = getTriggers('registry-test-model-b')
  assertEquals(
    result?.post?.created?.map((a) => (a.custom as { name: string }).name),
    ['static', 'from-db'],
  )
})

Deno.test('getTriggers returns just the static layer when nothing is persisted for a model', () => {
  setStaticTriggers(
    'registry-test-model-c',
    { post: { created: [{ custom: { name: 'static-only' } }] } },
  )

  assertEquals(getTriggers('registry-test-model-c'), {
    post: { created: [{ custom: { name: 'static-only' } }] },
  })
})

Deno.test('getTriggers returns just persisted when a model has no static triggers', () => {
  setPersistedTriggers(
    'registry-test-model-d',
    { post: { created: [{ custom: { name: 'db-only' } }] } },
  )

  assertEquals(getTriggers('registry-test-model-d'), {
    post: { created: [{ custom: { name: 'db-only' } }] },
  })
})

Deno.test('resetPersistedTriggers clears persisted but keeps static', () => {
  setStaticTriggers(
    'registry-test-model-e',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    'registry-test-model-e',
    { post: { created: [{ custom: { name: 'from-db' } }] } },
  )

  resetPersistedTriggers()

  assertEquals(getTriggers('registry-test-model-e'), {
    post: { created: [{ custom: { name: 'static' } }] },
  })
})

Deno.test('reset + a fresh set fully replaces the prior persisted load', () => {
  setPersistedTriggers(
    'registry-test-model-f',
    { post: { created: [{ custom: { name: 'old' } }] } },
  )

  resetPersistedTriggers()
  // Simulate a reload that no longer includes this model's entry (e.g. it became inactive).

  assertEquals(getTriggers('registry-test-model-f'), undefined)
})

Deno.test('getTriggers returns undefined for a model with nothing registered', () => {
  assertEquals(getTriggers('registry-test-model-never-registered'), undefined)
})

Deno.test('setStaticTriggers registers nothing when called with undefined the first time', () => {
  setStaticTriggers('registry-test-model-g', undefined)
  assertEquals(getTriggers('registry-test-model-g'), undefined)
})

Deno.test('setStaticTriggers clears a prior registration when re-called with undefined', () => {
  setStaticTriggers('registry-test-model-h', { post: { created: [{ custom: { name: 'x' } }] } })
  assertEquals(getTriggers('registry-test-model-h'), {
    post: { created: [{ custom: { name: 'x' } }] },
  })

  setStaticTriggers('registry-test-model-h', undefined)
  assertEquals(getTriggers('registry-test-model-h'), undefined)
})

Deno.test('getStaticTriggerEntries returns every registered model and its static triggers', () => {
  const triggers = { post: { created: [{ custom: { name: 'x' } }] } }
  setStaticTriggers('registry-test-model-entries', triggers)

  const entries = getStaticTriggerEntries()
  const match = entries.find(([name]) => name === 'registry-test-model-entries')

  assertEquals(match?.[1], triggers)
})

Deno.test('a default-suppressed model ignores its static layer entirely', () => {
  setStaticTriggers(
    'registry-test-model-suppressed',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    'registry-test-model-suppressed',
    { post: { created: [{ custom: { name: 'seeded' } }] } },
  )
  setDefaultSuppressed('registry-test-model-suppressed')

  assertEquals(getTriggers('registry-test-model-suppressed'), {
    post: { created: [{ custom: { name: 'seeded' } }] },
  })
})

Deno.test('a suppressed model with an inactive default entry dispatches nothing at all', () => {
  setStaticTriggers(
    'registry-test-model-suppressed-off',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setDefaultSuppressed('registry-test-model-suppressed-off')
  // No setPersistedTriggers call — the default entry exists but is currently inactive.

  assertEquals(getTriggers('registry-test-model-suppressed-off'), undefined)
})

Deno.test('resetPersistedTriggers also clears the default-suppression set', () => {
  setStaticTriggers(
    'registry-test-model-suppressed-reset',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setDefaultSuppressed('registry-test-model-suppressed-reset')

  resetPersistedTriggers()

  // No longer suppressed — falls back to the static layer, as if never seeded.
  assertEquals(getTriggers('registry-test-model-suppressed-reset'), {
    post: { created: [{ custom: { name: 'static' } }] },
  })
})
