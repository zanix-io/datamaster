import type { LoggerSaveData } from '@zanix/types'
import type { BulkIndexResult, ConnectorOptions } from '@zanix/server'
import type { ZanixElasticsearchConnector } from '../connector.ts'

export type { BulkIndexResult }

/** Basic-auth or API-key credentials for an Elasticsearch/OpenSearch cluster. */
export type ElasticsearchAuth =
  | { username: string; password: string }
  | { apiKey: string }

/**
 * Elasticsearch/OpenSearch connector options.
 */
export type ElasticsearchConnectorOptions = ConnectorOptions & {
  /**
   * Cluster URL (e.g. `https://localhost:9200`).
   * Falls back to `ELASTICSEARCH_URL`, then `OPENSEARCH_URL` (env vars), then
   * `http://localhost:9200` when omitted — same "explicit option always wins" precedence
   * `MONGO_URI`/`REDIS_URI` already follow elsewhere in this package.
   */
  node?: string
  /** Default index name (or a per-document name resolver) used when a call doesn't specify one. */
  index?: string | ((doc: Record<string, unknown>) => string)
  /**
   * Basic-auth or API-key credentials, sent as request headers.
   *
   * Basic auth (`{ username, password }`) has no env var counterpart — embed it directly in
   * `node`/`ELASTICSEARCH_URL`/`OPENSEARCH_URL` instead (`https://user:pass@host:9200`); `fetch`
   * honors userinfo in a URL and sends it as a real `Authorization: Basic` header. API-key auth
   * (`{ apiKey }`) falls back to `ELASTICSEARCH_API_KEY`, then `OPENSEARCH_API_KEY`, when this
   * option is omitted — a URL has no syntax to carry an arbitrary header value like an API key.
   */
  auth?: ElasticsearchAuth
}

/** Options for `elasticsearchLogSave`, DataMaster's `SaveDataFunction` factory for `@zanix/logger`. */
export type ElasticsearchLogSaveOptions = ElasticsearchConnectorOptions & {
  /** Reuse an already-constructed connector instead of building one from `node`/`auth`/env. */
  connector?: ZanixElasticsearchConnector
  /** Buffer flush policy — whichever threshold is reached first triggers a `_bulk` write. */
  bulk?: {
    /** Max buffered documents before an immediate flush. Defaults to `100`. */
    maxSize?: number
    /** Max milliseconds a document waits in the buffer before a flush. Defaults to `5000`. */
    flushIntervalMs?: number
  }
  /**
   * Aliases the formatted log's own timestamp field to `@timestamp` (the field Kibana/OpenSearch
   * Dashboards look for by default), without ever overwriting an already-present `@timestamp` and
   * without renaming/removing the original field. Only synthesizes a fresh timestamp when the
   * formatted log has no timestamp-like field at all. Defaults to `true`.
   */
  addTimestampField?: boolean
  /**
   * Runs the periodic bulk flush (not each individual log call) in a `WorkerManager` worker
   * thread, same as `@zanix/logger`'s own file-storage `useWorker` option. Defaults to `false`.
   */
  useWorker?: boolean
}

/**
 * The `SaveDataFunction` `elasticsearchLogSave` returns, with a `flush()` escape hatch attached —
 * buffered-but-unsent logs are otherwise only sent on the next size/time threshold, so a graceful
 * shutdown hook can call `flush()` to send whatever's currently buffered before the process exits.
 */
export type ElasticsearchLogSaveFunction = LoggerSaveData<Promise<void>> & {
  /** Immediately flushes whatever is currently buffered, ahead of its next scheduled flush. */
  flush: () => Promise<void>
}
