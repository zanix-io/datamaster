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
  /** Env var name for the Elasticsearch cluster URL. */
  ELASTICSEARCH_URL_ENV,
  /** Env var name for the OpenSearch cluster URL. */
  OPENSEARCH_URL_ENV,
  /** Connector for Elasticsearch OSS, Elasticsearch (Free tier), and OpenSearch. */
  ZanixElasticsearchConnector,
} from './connector.ts'
export {
  /** `@zanix/logger` `storage.save` factory that persists logs to Elasticsearch/OpenSearch. */
  elasticsearchLogSave,
} from './log-adapter.ts'

export type {
  /** The outcome of a `ZanixElasticsearchConnector.bulkIndex` call. */
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
} from './typings/general.ts'
