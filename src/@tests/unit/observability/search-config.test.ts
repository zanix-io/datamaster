import { assertEquals, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { resolveSearchEngine, SEARCH_ENGINE_ENV } from 'observability/search-config.ts'
import { registerElasticsearchConnector, registerMeilisearchConnector } from 'observability/core.ts'

/**
 * `SEARCH_ENGINE` is the single selector for the shared `'search'` core-connector slot — unlike the
 * old per-backend env vars (`ELASTICSEARCH_URL`/`OPENSEARCH_URL`/`MEILISEARCH_URL`, each implying its
 * own backend), only one value can ever be set at once, so there's no "both configured" state to
 * guard against — `resolveSearchEngine()`'s only failure mode is an unsupported value, not a
 * conflict between two simultaneously-set vars.
 */

const clearEnv = () => Deno.env.delete(SEARCH_ENGINE_ENV)

console.error = () => {}

Deno.test('resolveSearchEngine() returns undefined when SEARCH_ENGINE is unset', () => {
  clearEnv()
  assertEquals(resolveSearchEngine(), undefined)
})

for (const engine of ['elasticsearch', 'opensearch', 'meilisearch'] as const) {
  Deno.test(`resolveSearchEngine() resolves "${engine}" when SEARCH_ENGINE is set to it`, () => {
    Deno.env.set(SEARCH_ENGINE_ENV, engine)
    try {
      assertEquals(resolveSearchEngine(), engine)
    } finally {
      clearEnv()
    }
  })
}

Deno.test('resolveSearchEngine() throws a clear, unsupported-value InternalError otherwise', () => {
  Deno.env.set(SEARCH_ENGINE_ENV, 'solr')
  try {
    const error = assertThrows(
      () => resolveSearchEngine(),
      InternalError,
      'is set to "solr"',
    )
    assertEquals(error.code, 'SEARCH_ENGINE_UNSUPPORTED')
  } finally {
    clearEnv()
  }
})

Deno.test(
  'registerElasticsearchConnector() is a no-op when SEARCH_ENGINE is unset (no backend configured)',
  () => {
    clearEnv()
    registerElasticsearchConnector()
    assertEquals(true, true)
  },
)

Deno.test(
  'registerElasticsearchConnector() is a no-op when SEARCH_ENGINE selects meilisearch instead',
  () => {
    Deno.env.set(SEARCH_ENGINE_ENV, 'meilisearch')
    try {
      registerElasticsearchConnector()
      assertEquals(true, true)
    } finally {
      clearEnv()
    }
  },
)

Deno.test(
  'registerMeilisearchConnector() is a no-op when SEARCH_ENGINE selects elasticsearch instead',
  () => {
    Deno.env.set(SEARCH_ENGINE_ENV, 'elasticsearch')
    try {
      registerMeilisearchConnector()
      assertEquals(true, true)
    } finally {
      clearEnv()
    }
  },
)

Deno.test(
  'registerElasticsearchConnector()/registerMeilisearchConnector() both propagate the same ' +
    'unsupported-value error when SEARCH_ENGINE is invalid — re-validated on every standalone call',
  () => {
    Deno.env.set(SEARCH_ENGINE_ENV, 'solr')
    try {
      assertThrows(() => registerElasticsearchConnector(), InternalError, "isn't a supported")
      assertThrows(() => registerMeilisearchConnector(), InternalError, "isn't a supported")
    } finally {
      clearEnv()
    }
  },
)
