import type {
  BulkIndexResult,
  ElasticsearchAuth,
  ElasticsearchConnectorOptions,
} from './typings/general.ts'

import { ZanixSearchConnector } from '@zanix/server'

const DEFAULT_NODE = 'http://localhost:9200'
const DEFAULT_INDEX = 'zanix-logs'
const NDJSON_CONTENT_HEADER = { 'Content-Type': 'application/x-ndjson' }

/** Env var names for the cluster URL — exported so other packages (e.g. a general config
 * bootstrap) can read/gate on them without redefining the literal strings. */
export const ELASTICSEARCH_URL_ENV = 'ELASTICSEARCH_URL'
export const OPENSEARCH_URL_ENV = 'OPENSEARCH_URL'

/** Builds the `Authorization`/`ApiKey` header pair for a given set of Elasticsearch credentials. */
const authHeaders = (auth?: ElasticsearchAuth): Record<string, string> => {
  if (!auth) return {}
  if ('apiKey' in auth) return { Authorization: `ApiKey ${auth.apiKey}` }
  return { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` }
}

/**
 * Resolves the cluster URL: the explicit `node` option always wins; otherwise falls back to
 * `ELASTICSEARCH_URL`, then `OPENSEARCH_URL`, then a local-dev default — the same
 * explicit-option-over-env-var precedence `MONGO_URI`/`REDIS_URI` already follow elsewhere in
 * this package.
 *
 * Basic-auth credentials can be embedded directly in any of these (`https://user:pass@host:9200`)
 * — `fetch` honors userinfo in a URL and sends it as a real `Authorization: Basic` header, so no
 * separate username/password env vars are needed for that case; see `resolveAuth` below for the
 * API-key case, which a URL has no syntax for.
 */
const resolveNode = (node?: string): string =>
  node || Deno.env.get(ELASTICSEARCH_URL_ENV) || Deno.env.get(OPENSEARCH_URL_ENV) || DEFAULT_NODE

/**
 * Resolves auth credentials: the explicit `auth` option always wins; otherwise falls back to an
 * API key from `ELASTICSEARCH_API_KEY`, then `OPENSEARCH_API_KEY`. Basic auth has no env var
 * counterpart here — embed it in the URL instead (see `resolveNode` above).
 */
const resolveAuth = (auth?: ElasticsearchAuth): ElasticsearchAuth | undefined => {
  if (auth) return auth
  const apiKey = Deno.env.get('ELASTICSEARCH_API_KEY') || Deno.env.get('OPENSEARCH_API_KEY')
  return apiKey ? { apiKey } : undefined
}

/**
 * Connector for Elasticsearch OSS, Elasticsearch (Free tier), and OpenSearch — using only the
 * `_bulk`/`_doc`/`_cluster/health` endpoints, the most stable and least product-differentiated
 * part of the wire protocol across all three, over a plain `fetch`-based `RestClient` rather than
 * either vendor's official SDK (both actively version/product-check against the server in ways
 * that are unreliable across this specific trio of targets).
 *
 * Operates on plain `Record<string, unknown>` documents — it has no knowledge of `@zanix/logger`'s
 * formatted-log shape, so it's equally usable to index any document, not just logs. The dedicated
 * `@zanix/logger` integration is `elasticsearchLogSave` (`./log-adapter.ts`).
 *
 * Extends `@zanix/server`'s `ZanixSearchConnector`, the abstract base for the `'search'` core
 * connector category — this is what makes `@Connector('search')` registration valid (see
 * `core.ts`), rather than falling back to the generic `'custom'` target.
 *
 * @extends ZanixSearchConnector
 */
export class ZanixElasticsearchConnector extends ZanixSearchConnector {
  /** Default index name (or per-document resolver) used when a call doesn't specify one. */
  #defaultIndex: string | ((doc: Record<string, unknown>) => string)

  /**
   * Creates the connector, resolving the cluster URL/auth (option, then env var, then default —
   * see `resolveNode`/`resolveAuth`) and building the resulting auth headers.
   *
   * @param options - Connection options — `node`/`index`/`auth` plus the base `ConnectorOptions`
   * (`contextId`, `autoInitialize`) `RestClient` already accepts.
   */
  constructor(options: ElasticsearchConnectorOptions = {}) {
    const { node, index, auth, ...connectorOptions } = options
    super({
      ...connectorOptions,
      baseUrl: resolveNode(node),
      headers: authHeaders(resolveAuth(auth)),
    })
    this.#defaultIndex = index ?? DEFAULT_INDEX
  }

  /** Resolves the target index name for a given document, per the `index` option/argument. */
  #indexFor(doc: Record<string, unknown>, index?: string): string {
    if (index) return index
    return typeof this.#defaultIndex === 'function' ? this.#defaultIndex(doc) : this.#defaultIndex
  }

  /**
   * Resolves the target index for a call not tied to any one document (`search`/`refresh`).
   * Unlike `#indexFor`, there's no document to feed a per-document resolver function with, so a
   * function-shaped default index is skipped rather than called with a fake empty document — the
   * caller falls back to a broader, cluster-wide operation (no index prefix) in that case, unless
   * `opts.index` was given explicitly.
   */
  #broadIndexFor(index?: string): string | undefined {
    if (index) return index
    return typeof this.#defaultIndex === 'string' ? this.#defaultIndex : undefined
  }

  /** Indexes a single document via `POST /{index}/_doc`. */
  public override async index(
    doc: Record<string, unknown>,
    opts: { index?: string } = {},
  ): Promise<void> {
    await this.http.post(`${this.#indexFor(doc, opts.index)}/_doc`, {
      body: JSON.stringify(doc),
    })
  }

  /**
   * Bulk-indexes documents via `POST /_bulk`, building the required NDJSON body (an `{index:
   * {_index}}` action line followed by the document line, per document, terminated with a
   * trailing newline).
   *
   * The bulk endpoint responds `200` even when individual documents fail (e.g. a mapping
   * conflict) — those are reported per-item in the response body, not via the HTTP status, so
   * this inspects `items[].index.error` rather than relying on the request not having thrown.
   */
  public override async bulkIndex(
    docs: Record<string, unknown>[],
    opts: { index?: string } = {},
  ): Promise<BulkIndexResult> {
    if (!docs.length) return { errors: false, failedCount: 0 }

    const lines: string[] = []
    for (const doc of docs) {
      lines.push(JSON.stringify({ index: { _index: this.#indexFor(doc, opts.index) } }))
      lines.push(JSON.stringify(doc))
    }
    const body = lines.join('\n') + '\n'

    const response = await this.http.post<
      { errors: boolean; items: Array<Record<string, { error?: unknown }>> }
    >(
      '_bulk',
      { body, headers: NDJSON_CONTENT_HEADER },
    )

    const failedCount = response.errors
      ? response.items.filter((item) => Object.values(item)[0]?.error).length
      : 0

    return { errors: response.errors, failedCount }
  }

  /**
   * Runs a native Elasticsearch/OpenSearch query (the Query DSL) via `POST /{index}/_search`, or
   * cluster-wide via `POST /_search` if no index can be resolved (the connector's default `index`
   * is a per-document resolver function and no explicit `opts.index` was given).
   *
   * Deliberately untyped on `query`'s shape: the whole point of reaching for `search()` instead of
   * `index`/`bulkIndex` is the Query DSL itself, so it's passed through as-is rather than wrapped
   * in an abstraction that would just reinvent it. Only the response is generic, since callers
   * always know what they asked for.
   *
   * @template T - Expected shape of the parsed response body.
   * @param query - A raw Elasticsearch/OpenSearch Query DSL body (e.g. `{ query: { term: {...} } }`).
   * @param opts - Per-call options (e.g. a target index overriding the connector's default).
   */
  public async search<T = Record<string, unknown>>(
    query: Record<string, unknown>,
    opts: { index?: string } = {},
  ): Promise<T> {
    const index = this.#broadIndexFor(opts.index)
    return await this.http.post<T>(index ? `${index}/_search` : '_search', {
      body: JSON.stringify(query),
    })
  }

  /**
   * Forces an index refresh via `POST /{index}/_refresh` (or all indices via `POST /_refresh` if
   * no index can be resolved), making documents written just before this call immediately
   * searchable instead of waiting for the next automatic refresh cycle (near-real-time, ~1s by
   * default).
   *
   * Mainly useful for tests and read-your-own-write scenarios. Avoid calling this after every
   * write in a production hot path — forcing a refresh triggers extra segment work and can hurt
   * indexing throughput under load; log data typically doesn't need stronger-than-near-real-time
   * visibility.
   *
   * @param opts - Per-call options (e.g. a target index overriding the connector's default).
   */
  public async refresh(opts: { index?: string } = {}): Promise<void> {
    const index = this.#broadIndexFor(opts.index)
    await this.http.post(index ? `${index}/_refresh` : '_refresh')
  }

  /**
   * Pings the cluster via `GET /_cluster/health`.
   *
   * Not an `isHealthy()` override: `RestClient`'s own `isHealthy()` is synchronous `boolean` (a
   * REST client has no persistent connection state to check), so a real network probe can't be
   * expressed through that same signature. This is a separate, explicitly-awaited method for
   * callers who want to verify the cluster is actually reachable.
   */
  public async checkClusterHealth(): Promise<boolean> {
    try {
      await this.http.get('_cluster/health')
      return true
    } catch {
      return false
    }
  }
}
