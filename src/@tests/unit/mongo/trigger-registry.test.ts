import { assertEquals } from '@std/assert'
import {
  getStaticTriggerEntries,
  getTriggers,
  mergeTriggers,
  refreshPersistedTriggers,
  resetPersistedTriggers,
  setDefaultSuppressed,
  setPersistedTriggers,
  setStaticTriggers,
} from 'mongo/processor/triggers/registry.ts'

// deno-lint-ignore no-explicit-any
const fakeModel = (entries: any[]) => ({ find: () => ({ lean: () => Promise.resolve(entries) }) })

const CK = 'test-connector'

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
  setStaticTriggers(CK, 'registry-test-model-a', triggers)

  assertEquals(getTriggers(CK, 'registry-test-model-a'), triggers)
})

Deno.test('getTriggers combines the static and persisted layers', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-b',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    CK,
    'registry-test-model-b',
    { post: { created: [{ custom: { name: 'from-db' } }] } },
  )

  const result = getTriggers(CK, 'registry-test-model-b')
  assertEquals(
    result?.post?.created?.map((a) => (a.custom as { name: string }).name),
    ['static', 'from-db'],
  )
})

Deno.test('getTriggers returns just the static layer when nothing is persisted for a model', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-c',
    { post: { created: [{ custom: { name: 'static-only' } }] } },
  )

  assertEquals(getTriggers(CK, 'registry-test-model-c'), {
    post: { created: [{ custom: { name: 'static-only' } }] },
  })
})

Deno.test('getTriggers returns just persisted when a model has no static triggers', () => {
  setPersistedTriggers(
    CK,
    'registry-test-model-d',
    { post: { created: [{ custom: { name: 'db-only' } }] } },
  )

  assertEquals(getTriggers(CK, 'registry-test-model-d'), {
    post: { created: [{ custom: { name: 'db-only' } }] },
  })
})

Deno.test('resetPersistedTriggers clears persisted but keeps static', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-e',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    CK,
    'registry-test-model-e',
    { post: { created: [{ custom: { name: 'from-db' } }] } },
  )

  resetPersistedTriggers(CK)

  assertEquals(getTriggers(CK, 'registry-test-model-e'), {
    post: { created: [{ custom: { name: 'static' } }] },
  })
})

Deno.test('reset + a fresh set fully replaces the prior persisted load', () => {
  setPersistedTriggers(
    CK,
    'registry-test-model-f',
    { post: { created: [{ custom: { name: 'old' } }] } },
  )

  resetPersistedTriggers(CK)
  // Simulate a reload that no longer includes this model's entry (e.g. it became inactive).

  assertEquals(getTriggers(CK, 'registry-test-model-f'), undefined)
})

Deno.test('getTriggers returns undefined for a model with nothing registered', () => {
  assertEquals(getTriggers(CK, 'registry-test-model-never-registered'), undefined)
})

Deno.test('setStaticTriggers registers nothing when called with undefined the first time', () => {
  setStaticTriggers(CK, 'registry-test-model-g', undefined)
  assertEquals(getTriggers(CK, 'registry-test-model-g'), undefined)
})

Deno.test('setStaticTriggers clears a prior registration when re-called with undefined', () => {
  setStaticTriggers(CK, 'registry-test-model-h', { post: { created: [{ custom: { name: 'x' } }] } })
  assertEquals(getTriggers(CK, 'registry-test-model-h'), {
    post: { created: [{ custom: { name: 'x' } }] },
  })

  setStaticTriggers(CK, 'registry-test-model-h', undefined)
  assertEquals(getTriggers(CK, 'registry-test-model-h'), undefined)
})

Deno.test('getStaticTriggerEntries returns every registered model and its static triggers', () => {
  const triggers = { post: { created: [{ custom: { name: 'x' } }] } }
  setStaticTriggers(CK, 'registry-test-model-entries', triggers)

  const entries = getStaticTriggerEntries(CK)
  const match = entries.find(([name]) => name === 'registry-test-model-entries')

  assertEquals(match?.[1], triggers)
})

Deno.test('a default-suppressed model ignores its static layer entirely', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-suppressed',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setPersistedTriggers(
    CK,
    'registry-test-model-suppressed',
    { post: { created: [{ custom: { name: 'seeded' } }] } },
  )
  setDefaultSuppressed(CK, 'registry-test-model-suppressed')

  assertEquals(getTriggers(CK, 'registry-test-model-suppressed'), {
    post: { created: [{ custom: { name: 'seeded' } }] },
  })
})

Deno.test('a suppressed model with an inactive default entry dispatches nothing at all', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-suppressed-off',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setDefaultSuppressed(CK, 'registry-test-model-suppressed-off')
  // No setPersistedTriggers call — the default entry exists but is currently inactive.

  assertEquals(getTriggers(CK, 'registry-test-model-suppressed-off'), undefined)
})

Deno.test('refreshPersistedTriggers repopulates the persisted layer', async () => {
  const triggers = { post: { created: [{ custom: { name: 'refreshed' } }] } }
  await refreshPersistedTriggers(
    CK,
    fakeModel([{ model: 'registry-test-model-refresh', active: true, triggers }]),
  )

  assertEquals(getTriggers(CK, 'registry-test-model-refresh'), triggers)
})

Deno.test('refreshPersistedTriggers drops a model no longer active in the read', async () => {
  setPersistedTriggers(
    CK,
    'registry-test-model-refresh-drop',
    { post: { created: [{ custom: { name: 'stale' } }] } },
  )

  await refreshPersistedTriggers(CK, fakeModel([]))

  assertEquals(getTriggers(CK, 'registry-test-model-refresh-drop'), undefined)
})

Deno.test('refreshPersistedTriggers skips an inactive entry', async () => {
  await refreshPersistedTriggers(
    CK,
    fakeModel([{
      model: 'registry-test-model-refresh-inactive',
      active: false,
      triggers: { post: { created: [{ custom: { name: 'x' } }] } },
    }]),
  )

  assertEquals(getTriggers(CK, 'registry-test-model-refresh-inactive'), undefined)
})

Deno.test('refreshPersistedTriggers marks a default entry as suppressing static', async () => {
  setStaticTriggers(
    CK,
    'registry-test-model-refresh-default',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )

  await refreshPersistedTriggers(
    CK,
    fakeModel([{
      model: 'registry-test-model-refresh-default',
      active: true,
      isDefault: true,
      triggers: { post: { created: [{ custom: { name: 'seeded' } }] } },
    }]),
  )

  assertEquals(getTriggers(CK, 'registry-test-model-refresh-default'), {
    post: { created: [{ custom: { name: 'seeded' } }] },
  })
})

Deno.test('resetPersistedTriggers also clears the default-suppression set', () => {
  setStaticTriggers(
    CK,
    'registry-test-model-suppressed-reset',
    { post: { created: [{ custom: { name: 'static' } }] } },
  )
  setDefaultSuppressed(CK, 'registry-test-model-suppressed-reset')

  resetPersistedTriggers(CK)

  // No longer suppressed — falls back to the static layer, as if never seeded.
  assertEquals(getTriggers(CK, 'registry-test-model-suppressed-reset'), {
    post: { created: [{ custom: { name: 'static' } }] },
  })
})

Deno.test("resetPersistedTriggers doesn't touch another connector's state", () => {
  const modelName = 'registry-test-model-isolation'

  setStaticTriggers('connector-a', modelName, {
    post: { created: [{ custom: { name: 'a-static' } }] },
  })
  setPersistedTriggers('connector-a', modelName, {
    post: { created: [{ custom: { name: 'a-db' } }] },
  })

  setStaticTriggers('connector-b', modelName, {
    post: { created: [{ custom: { name: 'b-static' } }] },
  })
  setPersistedTriggers('connector-b', modelName, {
    post: { created: [{ custom: { name: 'b-db' } }] },
  })

  // Connector 'b' booting resets ITS OWN bucket — must not touch 'a's.
  resetPersistedTriggers('connector-b')

  assertEquals(
    getTriggers('connector-a', modelName)?.post?.created?.map((a) =>
      (a.custom as { name: string }).name
    ),
    ['a-static', 'a-db'],
  )
  // 'b' lost its persisted layer, keeps its static one — same as any single-connector reset would.
  assertEquals(getTriggers('connector-b', modelName), {
    post: { created: [{ custom: { name: 'b-static' } }] },
  })
})

Deno.test("getStaticTriggerEntries/getTriggers never see another connector's registrations", () => {
  setStaticTriggers('connector-x', 'registry-test-model-x-only', {
    post: { created: [{ custom: { name: 'x' } }] },
  })

  assertEquals(getTriggers('connector-y', 'registry-test-model-x-only'), undefined)
  assertEquals(
    getStaticTriggerEntries('connector-y').some(([name]) => name === 'registry-test-model-x-only'),
    false,
  )
})
