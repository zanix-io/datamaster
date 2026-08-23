import type { LoggerSaveData } from '@zanix/types'
import type { BulkIndexResult, ConnectorOptions } from '@zanix/server'
import type { ZanixElasticsearchConnector } from '../connector.ts'

export type { BulkIndexResult }

/** Basic-auth or API-key credentials for an Elasticsearch/OpenSearch cluster. */
export type ElasticsearchAuth =
  | { username: string; password: string }
  | { apiKey: string }

/**
 * Configuration options used when creating an Elasticsearch/OpenSearch index.
 *
 * These options are passed directly to the index creation API (`PUT /{index}`).
 * Settings such as shard count must be defined at creation time because some index
 * settings cannot be modified after the index already exists.
 *
 * `mappings` defines how OpenSearch should interpret document fields, including
 * field types used for indexing, searching, sorting, and aggregations.
 *
 * @example
 * ```ts
 * {
 *   settings: {
 *     number_of_shards: 1,
 *     number_of_replicas: 0,
 *   },
 *   mappings: {
 *     properties: {
 *       "@timestamp": {
 *         type: "date",
 *       },
 *       level: {
 *         type: "keyword",
 *       },
 *       message: {
 *         type: "text",
 *       },
 *     },
 *   },
 * }
 * ```
 */
export interface ElasticsearchIndexOptions {
  /**
   * Index name or per-document resolver used when a call does not specify an explicit index.
   */
  name?: string | ((doc: Record<string, unknown>) => string)
  /**
   * OpenSearch index settings applied when the index is created.
   *
   * Common settings include shard and replica configuration. Additional
   * OpenSearch index settings can be provided through arbitrary keys.
   */
  settings?: {
    /** Number of primary shards created for the index. */
    // deno-lint-ignore camelcase
    number_of_shards?: number

    /** Number of replica shards allocated for each primary shard. */
    // deno-lint-ignore camelcase
    number_of_replicas?: number

    [key: string]: unknown
  }
  /**
   * OpenSearch field mappings defining the schema of indexed documents.
   *
   * Mappings control how fields are stored and indexed. For example,
   * `keyword` fields are optimized for exact matches and aggregations, while
   * `text` fields are analyzed for full-text search.
   */
  mappings?: {
    properties?: Record<string, unknown>
    [key: string]: unknown
  }
}

/**
 * Elasticsearch/OpenSearch connector options.
 */
export type ElasticsearchConnectorOptions = ConnectorOptions & {
  /**
   * Cluster URL (e.g. `https://localhost:9200`).
   * Falls back to `SEARCH_URL` (env var), then `http://localhost:9200` when omitted — same
   * "explicit option always wins" precedence `MONGO_URI`/`REDIS_URI` already follow elsewhere in
   * this package.
   */
  node?: string
  /**
   * Index configuration.
   *
   * Defines the target index, optional automatic initialization behavior, and the settings/mappings
   * used when creating the index if it does not exist.
   */
  index?: ElasticsearchIndexOptions
  /**
   * Basic-auth or API-key credentials, sent as request headers.
   *
   * Basic auth (`{ username, password }`) has no env var counterpart — embed it directly in
   * `node`/`SEARCH_URL` instead (`https://user:pass@host:9200`); `fetch` honors userinfo in a URL
   * and sends it as a real `Authorization: Basic` header. API-key auth (`{ apiKey }`) falls back to
   * `ELASTICSEARCH_API_KEY`, then `OPENSEARCH_API_KEY`, when this option is omitted — a URL has no
   * syntax to carry an arbitrary header value like an API key.
   */
  auth?: ElasticsearchAuth
}

/** Shared base options between `ElasticsearchLogSaveOptions`'s `useWorker: true`/`false` variants. */
export type ElasticsearchLogSaveOptionsBase = ElasticsearchConnectorOptions & {
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
   * Enables automatic initialization of the target index before writing documents.
   *
   * When enabled, the index will be created or initialized automatically if needed.
   * The index can also be initialized manually by calling `ensureIndex()`.
   *
   * Defaults to `false`.
   */
  indexInitialize?: boolean
}

/** Options for `elasticsearchLogSave`, DataMaster's `SaveDataFunction` factory for `@zanix/logger`. */
export type ElasticsearchLogSaveOptions =
  | (ElasticsearchLogSaveOptionsBase & {
    /**
     * Reuse an already-constructed connector instead of building one from `node`/`auth`/env.
     *
     * Note: `connector` is only available in non-worker mode. When `useWorker = true`,
     * this option is ignored/not supported.
     */
    connector?: ZanixElasticsearchConnector
    /**
     * Executes bulk flush operations in a `WorkerManager` worker instead of the main thread.
     *
     * - `'one-time'`: Creates a new worker for each flush and disposes of it after the operation
     *   finishes. This matches the behavior of `@zanix/logger`'s file-storage `useWorker` option.
     * - `'persisted'`: Reuses a single long-lived worker across multiple flushes, avoiding worker
     *   startup overhead. This mode is only supported within the Zanix Core ecosystem, where worker
     *   lifecycle management is coordinated by the shared runtime. If persistent workers are
     *   unavailable, flush operations automatically fall back to the `'one-time'` strategy.
     *
     * This option only applies to bulk flushes. Individual log calls are never executed in workers;
     * they only enqueue documents into the internal buffer.
     *
     * When a worker is used, it creates its own Search connector instance. The Search connector
     * provided by the Zanix Core dependency injection container is not reused, since connectors
     * cannot be shared across worker threads.
     *
     * By default, this option is `undefined`, meaning flushes are executed on the main thread.
     */
    useWorker?: never
  })
  | (ElasticsearchLogSaveOptionsBase & {
    /**
     * Executes bulk flush operations in a `WorkerManager` worker instead of the main thread.
     *
     * - `'one-time'`: Creates a new worker for each flush and disposes of it after the operation
     *   finishes. This matches the behavior of `@zanix/logger`'s file-storage `useWorker` option.
     * - `'persisted'`: Reuses a single long-lived worker across multiple flushes, avoiding worker
     *   startup overhead. This mode is only supported within the Zanix Core ecosystem, where worker
     *   lifecycle management is coordinated by the shared runtime. If persistent workers are
     *   unavailable, flush operations automatically fall back to the `'one-time'` strategy.
     *
     * This option only applies to bulk flushes. Individual log calls are never executed in workers;
     * they only enqueue documents into the internal buffer.
     *
     * When a worker is used, it creates its own Search connector instance. The Search connector
     * provided by the Zanix Core dependency injection container is not reused, since connectors
     * cannot be shared across worker threads.
     *
     * By default, this option is `undefined`, meaning flushes are executed on the main thread.
     */
    useWorker?: 'one-time' | 'persisted'

    /**
     * Reuse an already-constructed connector instead of building one from `node`/`auth`/env.
     *
     * Note: `connector` is not supported when `useWorker = true`.
     */
    connector?: never
  })

/**
 * The `SaveDataFunction` `elasticsearchLogSave` returns, with a `flush()` escape hatch attached —
 * buffered-but-unsent logs are otherwise only sent on the next size/time threshold, so a graceful
 * shutdown hook can call `flush()` to send whatever's currently buffered before the process exits.
 */
export type ElasticsearchLogSaveFunction = LoggerSaveData<Promise<void>> & {
  /** Immediately flushes whatever is currently buffered, ahead of its next scheduled flush. */
  flush: () => Promise<void>
}

// --- Meilisearch ---------------------------------------------------------------------------------

/**
 * Index configuration for {@link MeilisearchConnector}.
 *
 * Unlike Elasticsearch/OpenSearch, Meilisearch auto-creates an index the moment documents are first
 * written to it (confirmed against Meilisearch's own docs — see `meilisearch-connector.ts`'s class
 * doc) — there is deliberately no `ensureIndex()`-equivalent here, and no `settings`/`mappings`
 * creation-time options to go with one.
 */
export interface MeilisearchIndexOptions {
  /** Index name or per-document resolver used when a call does not specify an explicit index. */
  name?: string | ((doc: Record<string, unknown>) => string)
  /**
   * Overrides the field Meilisearch treats as this index's primary key, sent as the `primaryKey`
   * query parameter on the document-write request. Only needed when a document's own primary-key
   * field isn't named `id` (Meilisearch's own inference default) — see Meilisearch's "Primary field"
   * docs.
   */
  primaryKey?: string
}

/** Meilisearch connector options. */
export type MeilisearchConnectorOptions = ConnectorOptions & {
  /**
   * Instance URL (e.g. `https://localhost:7700`). Falls back to `SEARCH_URL`, then
   * `http://localhost:7700` — Meilisearch's own real default (`MEILI_HTTP_ADDR=localhost:7700`),
   * verified against Meilisearch's self-hosting configuration reference.
   */
  host?: string
  /**
   * The Meilisearch API key, sent as `Authorization: Bearer {apiKey}` (confirmed against
   * Meilisearch's own API reference — there is no URL-userinfo equivalent the way Elasticsearch's
   * Basic auth has one; every request needs the header). Falls back to `MEILISEARCH_API_KEY`.
   */
  apiKey?: string
  /** Index configuration. */
  index?: MeilisearchIndexOptions
  /**
   * Whether `bulkIndex()` polls its enqueued task(s) to a terminal status (`succeeded`/`failed`/
   * `canceled`) before resolving, so the returned `{errors, failedCount}` reflects the REAL outcome.
   *
   * Meilisearch's document-write API is fundamentally asynchronous — every write enqueues a task and
   * returns immediately with `status: "enqueued"`, unlike Elasticsearch's `_bulk`, which reports
   * per-item results inline in the same response. Defaults to `true` so `bulkIndex()`'s return value
   * is meaningful out of the box; set `false` for fire-and-forget semantics instead (no polling
   * latency), accepting that the returned result is then always `{errors: false, failedCount: 0}`
   * regardless of the real, eventual outcome.
   */
  waitForTask?: boolean
  /** Polling interval while waiting for a task to reach a terminal status. Defaults to `200`. */
  pollIntervalMs?: number
  /**
   * Max total time to wait for a task to reach a terminal status before `bulkIndex()` throws.
   * Defaults to `10000`. A timeout throws rather than returning a guessed result — the task may
   * still succeed or fail after this window closes; reporting either outcome without knowing it
   * would be a fabricated result, not a real one.
   */
  pollTimeoutMs?: number
}

/**
 * A single Meilisearch task, as returned by both the document-write endpoints (in `enqueued` form)
 * and `GET /tasks/{taskUid}` (once polled to a terminal status). Field names for the common case
 * (`taskUid`, `indexUid`, `status`, `type`, `error`) are confirmed against Meilisearch's own API
 * reference; `details`' exact per-type field names (e.g. `indexedDocuments`) are NOT fully
 * documented publicly for `documentAdditionOrUpdate` specifically, so `details` is typed loosely
 * (`Record<string, unknown>`) and read defensively — see {@link MeilisearchConnector.bulkIndex}'s own
 * doc for how a missing/renamed field there is handled without asserting a wrong claim.
 */
export interface MeilisearchTask {
  /** Unique identifier of the task, used to poll `GET /tasks/{taskUid}`. */
  taskUid: number
  /** Index the task was enqueued against. */
  indexUid: string
  /** Current lifecycle status of the task. */
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  /** Task type, e.g. `documentAdditionOrUpdate`. */
  type: string
  /** Type-specific result payload; shape is not fully documented publicly, read defensively. */
  details?: Record<string, unknown>
  /** Present when `status` is `failed`; `null`/absent otherwise. */
  error?: { message: string; code: string; type: string; link: string } | null
}
