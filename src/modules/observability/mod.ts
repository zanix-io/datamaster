/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * Elasticsearch/OpenSearch persistence for `@zanix/logger`: `ZanixElasticsearchConnector`
 * follows this package's own connector conventions (env-var-backed options, `isReady`
 * lifecycle), and `elasticsearchLogSave` bridges it to `Logger`'s `storage.save` extension point
 * as a reusable `SaveDataFunction` factory.
 *
 * @module zanixObservability
 */

export {
  /** Connector for Elasticsearch OSS, Elasticsearch (Free tier), and OpenSearch. */
  ZanixElasticsearchConnector,
} from './connector.ts'
export {
  /** `@zanix/logger` `storage.save` factory that persists logs to Elasticsearch/OpenSearch. */
  elasticsearchLogSave,
} from './log-adapter.ts'
export {
  /** Env var name for the Meilisearch API key. */
  MEILISEARCH_API_KEY_ENV,
  /** Connector for Meilisearch. */
  MeilisearchConnector,
} from './meilisearch-connector.ts'
export {
  /** Resolves and validates the configured `SEARCH_ENGINE`, if any. */
  resolveSearchEngine,
  /** Env var selecting which search engine registers under the shared `'search'` core connector
   * slot — one of `SEARCH_ENGINES`. */
  SEARCH_ENGINE_ENV,
  /** Supported `SEARCH_ENGINE` values. */
  SEARCH_ENGINES,
  /** Env var for the selected search engine's connection URL. */
  SEARCH_URL_ENV,
} from './search-config.ts'

export type {
  /** The outcome of a `ZanixElasticsearchConnector.bulkIndex`/`MeilisearchConnector.bulkIndex` call. */
  BulkIndexResult,
  /** Basic-auth or API-key credentials for an Elasticsearch/OpenSearch cluster. */
  ElasticsearchAuth,
  /** `ZanixElasticsearchConnector` constructor options. */
  ElasticsearchConnectorOptions,
  /** Index name/settings/mappings configuration, e.g. `ElasticsearchConnectorOptions.index`. */
  ElasticsearchIndexOptions,
  /** The `SaveDataFunction` `elasticsearchLogSave` returns, with a `flush()` escape hatch. */
  ElasticsearchLogSaveFunction,
  /** Options for `elasticsearchLogSave`. */
  ElasticsearchLogSaveOptions,
  /** Shared base of `ElasticsearchLogSaveOptions`'s `useWorker: true`/`false` variants. */
  ElasticsearchLogSaveOptionsBase,
  /** `MeilisearchConnector` constructor options. */
  MeilisearchConnectorOptions,
  /** Index name/primary-key configuration, e.g. `MeilisearchConnectorOptions.index`. */
  MeilisearchIndexOptions,
  /** A single Meilisearch task, as returned by the document-write/`GET /tasks/{taskUid}` endpoints. */
  MeilisearchTask,
} from './typings/general.ts'

export type {
  /** A supported `SEARCH_ENGINE` value. */
  SearchEngine,
} from './search-config.ts'
