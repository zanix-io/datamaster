import { assert, assertEquals } from '@std/assert'
import { MeilisearchConnector } from 'observability/mod.ts'
import '../../(setup)/envars.ts'

console.error = () => {}

/**
 * These tests run against a REAL local Meilisearch instance instead of a mocked `fetch` — the
 * mocked unit tests in `src/@tests/unit/observability/meilisearch-connector.test.ts` confirm the
 * connector issues the right requests in the right sequence, but not that a real instance's task
 * queue actually behaves the way those mocked responses assume (real polling latency, real
 * terminal-status transitions, real error shapes).
 *
 * Skipped by default (see `shouldRun` below) so a plain `deno test --allow-all` doesn't require
 * Docker/Meilisearch to be running. To enable:
 *
 * 1. Start a local Meilisearch instance:
 *    ```sh
 *    docker run -d --name zanix-meilisearch-test \
 *      -p 7700:7700 \
 *      -e "MEILI_NO_ANALYTICS=true" \
 *      getmeili/meilisearch:v1.11
 *    ```
 * 2. Copy `.env.test.example` to `.env.test` (gitignored) at the project root — it sets
 *    `RUN_MEILISEARCH_TESTS=true`, loaded automatically below.
 * 3. `deno test --allow-all src/@tests/functional/observability/`
 *
 * See docs/observability.md#testing-against-a-real-local-cluster for more.
 */

const shouldRun = Deno.env.get('RUN_MEILISEARCH_TESTS') === 'true'

const uniqueIndex = () => `test-observability-${crypto.randomUUID()}`

const dropIndex = (connector: MeilisearchConnector, index: string) =>
  connector.http.delete(`indexes/${index}`).catch(() => {})

/** Meilisearch's search endpoint isn't exposed on the connector itself (write-path only, per its
 * own class doc) — reach `POST /indexes/{index}/search` directly via the connector's own `http`,
 * the same way `connector-real.test.ts` reaches ES's `http.delete` for cleanup. */
const searchCount = async (
  connector: MeilisearchConnector,
  index: string,
  q: string,
): Promise<number> => {
  const result = await connector.http.post<{ estimatedTotalHits: number }>(
    `indexes/${index}/search`,
    { body: JSON.stringify({ q }) },
  )
  return result.estimatedTotalHits
}

Deno.test({
  name: 'checkHealth() reflects a real reachable local Meilisearch instance',
  ignore: !shouldRun,
  fn: async () => {
    const connector = new MeilisearchConnector({ autoInitialize: false })
    assert(await connector.checkHealth())
  },
})

Deno.test({
  name:
    'index()/bulkIndex() write real, searchable documents (real async task queue, not a scripted mock sequence)',
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new MeilisearchConnector({
      index: { name: index },
      autoInitialize: false,
    })
    const tag = crypto.randomUUID()

    try {
      await connector.index({ id: 1, tag, kind: 'single' })
      const result = await connector.bulkIndex([
        { id: 2, tag, kind: 'bulk-1' },
        { id: 3, tag, kind: 'bulk-2' },
      ])

      // bulkIndex() resolved only after polling the real task to a terminal "succeeded" status —
      // if it returned as soon as the write was merely enqueued, this assertion (and the search
      // just below, run with no extra wait) would be flaky against real indexing latency.
      assertEquals(result, { errors: false, failedCount: 0 })
      assertEquals(await searchCount(connector, index, tag), 3)
    } finally {
      await dropIndex(connector, index)
    }
  },
})

Deno.test({
  name:
    "bulkIndex() reports a real, whole-task failure on an invalid document identifier — confirms Meilisearch fails a write TASK atomically, not per-document like ES's _bulk",
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new MeilisearchConnector({
      index: { name: index, primaryKey: 'id' },
      autoInitialize: false,
    })

    try {
      // Confirmed empirically against a real instance before writing this test: mixing one
      // genuinely valid document with one whose `id` is an object (Meilisearch only accepts a
      // string/integer document identifier) fails the ENTIRE task — `details.indexedDocuments`
      // comes back `0`, not `1`. Unlike Elasticsearch's `_bulk` (partial per-item failure, see
      // `connector-real.test.ts`'s own mapping-conflict test), a Meilisearch write task is
      // all-or-nothing; `failedCount` reflects that atomicity, not a partial count.
      const result = await connector.bulkIndex([
        { id: 'valid-1', kind: 'ok' },
        // deno-lint-ignore no-explicit-any
        { id: { nested: 'bad' } as any, kind: 'bad' },
      ])

      assertEquals(result.errors, true)
      assertEquals(result.failedCount, 2)
      assertEquals(await searchCount(connector, index, ''), 0)
    } finally {
      await dropIndex(connector, index)
    }
  },
})

Deno.test({
  name:
    'bulkIndex() with waitForTask disabled resolves before the real task finishes, against a real (non-mocked) task queue',
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new MeilisearchConnector({
      index: { name: index },
      waitForTask: false,
      autoInitialize: false,
    })

    try {
      const result = await connector.bulkIndex([{ id: 1, kind: 'fire-and-forget' }])
      // Contract per the connector's own doc: resolves as soon as the write is enqueued, without
      // polling — always reports success/no-failure-count regardless of what the task later does.
      assertEquals(result, { errors: false, failedCount: 0 })
    } finally {
      await dropIndex(connector, index)
    }
  },
})
