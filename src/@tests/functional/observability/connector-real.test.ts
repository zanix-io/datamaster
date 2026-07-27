import { Logger } from '@zanix/logger'
import { assert, assertEquals } from '@std/assert'
import { elasticsearchLogSave, ZanixElasticsearchConnector } from 'observability/mod.ts'
import '../../(setup)/envars.ts'

console.error = () => {}

/**
 * These tests run against a REAL local Elasticsearch/OpenSearch instance instead of a mocked
 * `fetch` — the mocked unit tests in `src/@tests/unit/observability/` don't catch a real,
 * cluster-specific edge case (a genuine mapping conflict, real `.keyword` sub-field mapping) the
 * same way.
 *
 * Skipped by default (see `shouldRun` below) so a plain `deno test --allow-all` doesn't require
 * Docker/OpenSearch to be running. To enable:
 *
 * 1. Start a local single-node OpenSearch:
 *    ```sh
 *    docker run -d --name zanix-opensearch-test \
 *      -p 9200:9200 -p 9600:9600 \
 *      -e "discovery.type=single-node" \
 *      -e "DISABLE_SECURITY_PLUGIN=true" \
 *      -e "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
 *      opensearchproject/opensearch:2
 *    ```
 * 2. Copy `.env.test.example` to `.env.test` (gitignored) at the project root — it sets
 *    `RUN_OPENSEARCH_TESTS=true`, loaded automatically below.
 * 3. `deno test --allow-all src/@tests/functional/observability/`
 *
 * See docs/OBSERVABILITY.md#testing-against-a-real-local-cluster for more.
 */

const shouldRun = Deno.env.get('RUN_OPENSEARCH_TESTS') === 'true'

const uniqueIndex = () => `test-observability-${crypto.randomUUID()}`

const dropIndex = (connector: ZanixElasticsearchConnector, index: string) =>
  connector.http.delete(index).catch(() => {})

Deno.test({
  name: 'checkClusterHealth() reflects a real reachable local cluster',
  ignore: !shouldRun,
  fn: async () => {
    const connector = new ZanixElasticsearchConnector({ autoInitialize: false })
    assert(await connector.checkClusterHealth())
  },
})

Deno.test({
  name: 'index()/bulkIndex() write real, searchable documents',
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new ZanixElasticsearchConnector({ index, autoInitialize: false })
    const tag = crypto.randomUUID()

    try {
      await connector.index({ tag, kind: 'single' })
      await connector.bulkIndex([{ tag, kind: 'bulk-1' }, { tag, kind: 'bulk-2' }])
      await connector.refresh()

      // `tag` gets dynamically mapped as `text` (analyzed), so an exact `term` match needs the
      // `.keyword` sub-field OpenSearch generates alongside it — a `term` query directly against
      // `tag` would search the tokenized/analyzed terms, not the raw UUID string.
      const result = await connector.search<{ hits: { total: { value: number } } }>({
        query: { term: { 'tag.keyword': tag } },
      })
      assertEquals(result.hits.total.value, 3)
    } finally {
      await dropIndex(connector, index)
    }
  },
})

Deno.test({
  name: 'bulkIndex() reports a real partial failure on a genuine mapping conflict',
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new ZanixElasticsearchConnector({ index, autoInitialize: false })

    try {
      // The first document establishes a dynamic mapping of `conflictField` as `long` — a numeric
      // field, not a string. Sending a string into an existing string/text field doesn't actually
      // conflict (OpenSearch coerces it), but a string that isn't parseable as a number DOES fail
      // against an existing numeric mapping, which is the real conflict direction verified here.
      await connector.index({ conflictField: 123 })

      // A second document reusing the same field with an incompatible type triggers a real
      // mapper_parsing_exception from the cluster, not a simulated one.
      const result = await connector.bulkIndex([
        { conflictField: 456 },
        { conflictField: 'not-a-number' },
      ])

      assertEquals(result.errors, true)
      assertEquals(result.failedCount, 1)
    } finally {
      await dropIndex(connector, index)
    }
  },
})

Deno.test({
  name:
    'elasticsearchLogSave(): a real Logger persists to OpenSearch and flush() sends immediately',
  ignore: !shouldRun,
  fn: async () => {
    const index = uniqueIndex()
    const connector = new ZanixElasticsearchConnector({ index, autoInitialize: false })
    const tag = crypto.randomUUID()

    try {
      const save = elasticsearchLogSave({ connector, bulk: { flushIntervalMs: 100_000 } })
      const logger = new Logger({ storage: { save }, disableGlobalAssign: true })

      logger.error(`functional test log ${tag}`, { meta: { tag } })
      await save.flush()
      await connector.refresh()

      const result = await connector.search<{ hits: { total: { value: number } } }>({
        query: { match_phrase: { message: tag } },
      })

      assertEquals(result.hits.total.value, 1)
    } finally {
      await dropIndex(connector, index)
    }
  },
})
