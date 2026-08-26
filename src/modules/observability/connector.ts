import logger from '@zanix/logger'
import type {
  BulkIndexResult,
  ElasticsearchAuth,
  ElasticsearchConnectorOptions,
  ElasticsearchIndexOptions,
} from './typings/general.ts'

import { ProgramModule, ZanixSearchConnector } from '@zanix/server'
import {
  ELASTICSEARCH_API_KEY_ENV,
  OPENSEARCH_API_KEY_ENV,
  SEARCH_URL_ENV,
} from './search-config.ts'

const DEFAULT_NODE = 'http://localhost:9200'
const DEFAULT_INDEX = 'zanix-logs'
const NDJSON_CONTENT_HEADER = { 'Content-Type': 'application/x-ndjson' }

/** Builds the `Authorization`/`ApiKey` header pair for a given set of Elasticsearch credentials. */
const authHeaders = (auth?: ElasticsearchAuth): Record<string, string> => {
  if (!auth) return {}
  if ('apiKey' in auth) return { Authorization: `ApiKey ${auth.apiKey}` }
  return {
    Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}`,
  }
}

/**
 * Resolves the cluster URL: the explicit `node` option always wins; otherwise falls back to
 * `SEARCH_URL`, then a local-dev default — the same explicit-option-over-env-var precedence
 * `MONGO_URI`/`REDIS_URI` already follow elsewhere in this package.
 *
 * Basic-auth credentials can be embedded directly in either of these (`https://user:pass@host:9200`)
 * — `fetch` honors userinfo in a URL and sends it as a real `Authorization: Basic` header, so no
 * separate username/password env vars are needed for that case; see `resolveAuth` below for the
 * API-key case, which a URL has no syntax for.
 */
const resolveNode = (node?: string): string => node || Deno.env.get(SEARCH_URL_ENV) || DEFAULT_NODE

/**
 * Resolves auth credentials: the explicit `auth` option always wins; otherwise falls back to an
 * API key from `ELASTICSEARCH_API_KEY`, then `OPENSEARCH_API_KEY`. Basic auth has no env var
 * counterpart here — embed it in the URL instead (see `resolveNode` above).
 */
const resolveAuth = (
  auth?: ElasticsearchAuth,
): ElasticsearchAuth | undefined => {
  if (auth) return auth
  const apiKey = Deno.env.get(ELASTICSEARCH_API_KEY_ENV) ||
    Deno.env.get(OPENSEARCH_API_KEY_ENV)
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
  /** Default index options for initialization */
  #defaultIndexOptions?: ElasticsearchIndexOptions
  /** Display name used in connection/disconnection log messages. */
  private name: string

  #indexInitialized = (_: string | string[]) => Promise.resolve(true)

  /** Indicates whether `ensureIndex` has already completed before a bulk write. */
  public set indexInitialized(
    indexInitialized: (index: string | string[]) => Promise<boolean>,
  ) {
    this.#indexInitialized = indexInitialized
  }
  public get indexInitialized(): (
    index: string | string[],
  ) => Promise<boolean> {
    return this.#indexInitialized
  }

  /**
   * Creates the connector, resolving the cluster URL/auth (option, then env var, then default —
   * see `resolveNode`/`resolveAuth`) and building the resulting auth headers.
   *
   * @param options - Connection options — `node`/`index`/`auth` plus the base `ConnectorOptions`
   * (`contextId`, `autoInitialize`) `RestClient` already accepts.
   */
  constructor(options: ElasticsearchConnectorOptions = {}) {
    const { node, index = {}, auth, ...connectorOptions } = options
    super({
      ...connectorOptions,
      baseUrl: resolveNode(node),
      headers: authHeaders(resolveAuth(auth)),
    })
    this.#defaultIndex = index.name ?? DEFAULT_INDEX
    this.#defaultIndexOptions = index
    // `coreDisplayName` (`ZanixConnector`, `@zanix/server`) strips the internal `_Zanix`-prefixed
    // synthetic subclass name a core connector is auto-registered under, falling back to
    // 'elastic search core' — a no-op for any ordinary, consumer-authored subclass.
    this.name = this.coreDisplayName('elastic search core')
  }

  /**
   * Resolves the target index name for a given document, per the `index` option/argument — which,
   * same as the connector-level default, may itself be a static name or a per-document resolver
   * (see `bulkIndex()`'s own doc for why a call-level override needs the same shape as the
   * connector-level default, not just a static string).
   */
  #indexFor(
    doc: Record<string, unknown>,
    index?: string | ((doc: Record<string, unknown>) => string),
  ): string {
    if (index) return typeof index === 'function' ? index(doc) : index
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
    opts: { index?: string | ((doc: Record<string, unknown>) => string) } = {},
  ): Promise<void> {
    const index = this.#indexFor(doc, opts.index)
    await this.indexInitialized(index)
    await this.http.post(`${index}/_doc`, {
      body: JSON.stringify(doc),
    })
  }

  /**
   * Ensures that the given index (or indexes) exists, creating it with the provided settings and
   * mappings when necessary.
   *
   * Uses `HEAD /{index}` as a lightweight existence check before creating the index with
   * `PUT /{index}`. If the index already exists, this method is a no-op and does not attempt to
   * modify its settings or mappings.
   *
   * This method is intended to run before the first indexing operation when callers need control
   * over index creation parameters such as shard count, replicas, or field mappings. OpenSearch
   * only allows certain settings to be configured at index creation time (for example,
   * `number_of_shards`), so relying on automatic index creation may lock in undesired defaults.
   *
   * Takes an already-resolved index name (or names) rather than a resolver function — unlike
   * `index()`/`bulkIndex()`, which accept a per-document resolver (see their own `opts.index`
   * doc), there is no document here to evaluate one against, so a caller (or `indexInitialized`'s
   * own wiring — see `wireIndexInitialize` below) must resolve any function-shaped `index` option
   * down to concrete name(s) before calling this. Does not itself validate or throw on a
   * function-shaped input; passing one here would just be coerced to a string at the HTTP layer.
   *
   * @param index - The already-resolved index name(s) to ensure exist.
   * @param opts - Index creation options including OpenSearch settings and mappings.
   */
  public async ensureIndex(
    index: string | string[],
    opts: Omit<ElasticsearchIndexOptions, 'name'> = {},
  ): Promise<boolean> {
    const options = { ...this.#defaultIndexOptions, ...opts }

    const indexes = [...new Set(typeof index === 'string' ? [index] : index)]

    const promises: Promise<Response>[] = []
    for (const idx of indexes) {
      promises.push(
        this.http.head(idx).catch(() => {
          return this.http.put(idx, {
            body: JSON.stringify({
              settings: options.settings,
              mappings: options.mappings,
            }),
          })
        }),
      )
    }

    await Promise.all(promises)

    logger.success(
      `ElasticSearch Index Initialized Successfully through '${this.name}' class`,
    )

    return true
  }

  /**
   * Bulk-indexes documents via `POST /_bulk`, building the required NDJSON body (an `{index:
   * {_index}}` action line followed by the document line, per document, terminated with a
   * trailing newline).
   *
   * The bulk endpoint responds `200` even when individual documents fail (e.g. a mapping
   * conflict) — those are reported per-item in the response body, not via the HTTP status, so
   * this inspects `items[].index.error` rather than relying on the request not having thrown.
   *
   * `opts.index` accepts the same shape as the connector-level default (a static name or a
   * per-document resolver) — not just a static string — so a caller overriding the index for a
   * single call can still target a different index per document within that same batch. This is
   * what lets `elasticsearchLogSave`'s own `flushInline` (`log-adapter.ts`) forward the caller's
   * configured `index.name` as a per-call override, whether that's a static name or a resolver
   * function, without ever touching this connector's own default index.
   */
  public override async bulkIndex(
    docs: Record<string, unknown>[],
    opts: { index?: string | ((doc: Record<string, unknown>) => string) } = {},
  ): Promise<BulkIndexResult> {
    if (!docs.length) return { errors: false, failedCount: 0 }

    const lines: string[] = []
    const indexes: string[] = []
    for (const doc of docs) {
      const index = this.#indexFor(doc, opts.index)
      indexes.push(index)
      lines.push(
        JSON.stringify({ index: { _index: index } }),
      )
      lines.push(JSON.stringify(doc))
    }
    const body = lines.join('\n') + '\n'
    await this.indexInitialized(indexes)

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
    if (index) await this.indexInitialized(index)
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

/**
 * Connectors {@link wireIndexInitialize} has already wired an `indexInitialized` closure onto.
 * `getConnector()` itself runs on every flush cycle (`flushInline()` calls it fresh each time —
 * see its own doc), even though the connector it resolves is the same reused core singleton every
 * time (see `getConnector()`'s own doc below). Without this guard, every one of those calls would
 * unconditionally reassign `indexInitialized` back to a brand-new "call `ensureIndex()` again"
 * closure — even after a previous call already replaced it with the permanent no-op below —
 * silently undoing that memoization and re-running `ensureIndex()` (and its success log) on every
 * flush cycle instead of once. A `WeakSet` keyed on the connector instance makes the wiring itself
 * idempotent regardless of how many times {@link wireIndexInitialize} runs against the same
 * instance — reached both from `getConnector()` (a DI-resolved connector) and directly from a
 * caller-supplied connector (`log-adapter.ts`'s `flushInline`) — without adding any public API
 * surface to `ZanixElasticsearchConnector` for what's purely this bookkeeping's own concern.
 */
const wiredForIndexInit = new WeakSet<ZanixElasticsearchConnector>()

/**
 * Wires `indexInitialized` (see {@link ZanixElasticsearchConnector.indexInitialized}) onto the
 * given connector instance so it lazily `ensureIndex()`s before first use, driven by
 * `indexInitialize` — the shared "wire it, at most once, self-memoizing" logic behind
 * `getConnector()`'s own resolution of the `'search'` core connector, extracted so it applies
 * equally to a connector `getConnector()` resolves AND to a caller-supplied connector instance
 * that never goes through `getConnector()` at all (see `log-adapter.ts`'s `flushInline`, which
 * calls this directly on a `connector` option instead).
 *
 * Wired at most once per connector instance (see `wiredForIndexInit` above) and self-memoizing to
 * a permanent no-op after its first successful run, so a connector whose index has already been
 * ensured never re-runs `ensureIndex()` (or logs a duplicate success message) on a later call.
 * A no-op (returns `connector` unchanged) when `indexInitialize` is falsy or the connector was
 * already wired.
 *
 * @param connector - The connector instance to wire (or leave untouched).
 * @param indexInitialize - Whether to wire `ensureIndex()`-on-first-use at all.
 * @param connectorOptions - Supplies the `index` settings/mappings forwarded to `ensureIndex()`.
 */
export const wireIndexInitialize = (
  connector: ZanixElasticsearchConnector,
  indexInitialize: boolean | undefined,
  connectorOptions: Pick<ElasticsearchConnectorOptions, 'index'>,
): ZanixElasticsearchConnector => {
  if (indexInitialize && !wiredForIndexInit.has(connector)) {
    wiredForIndexInit.add(connector)
    connector.indexInitialized = async (index) => {
      const result = await connector.ensureIndex(index, connectorOptions.index)
      // Self-memoize: once the index is confirmed ensured, every later call (this or any later
      // flush cycle reusing this same connector) is a pure no-op — no repeat HTTP round trips,
      // no repeat success log.
      connector.indexInitialized = () => Promise.resolve(true)
      return result
    }
  }

  return connector
}

/**
 * Resolves the `'search'` core connector — the same shared instance any other
 * `this.connectors.get('search')`/`this.getProviderConnector('search')` call in the process
 * resolves, reused rather than duplicated. Optionally wires `indexInitialized` via
 * {@link wireIndexInitialize}, driven by `indexInitialize`/`connectorOptions.index`.
 *
 * @throws If nothing is registered under `'search'` in this process — no silent fallback
 *   construction; see this function's own inline doc for why a fallback would be actively
 *   dangerous here (masking a real "the app forgot to import `@zanix/datamaster/core`"
 *   misconfiguration as a working-but-pointed-nowhere-real connector).
 */
export const getConnector = (
  { indexInitialize, ...connectorOptions }: ElasticsearchConnectorOptions & {
    indexInitialize?: boolean
  },
) => {
  // No fallback construction when nothing is registered under `'search'` — let
  // `ProgramModule.getConnectors().get('search')`'s own real error propagate (`@zanix/server`
  // already produces a clear "did you forget to import @zanix/datamaster/core?" message; see
  // `missingCoreSlotError`, `server/src/modules/program/public.ts`). Silently constructing a
  // standalone `ZanixElasticsearchConnector` here — potentially against nothing but a bare,
  // possibly-unset env var (`SEARCH_URL`, defaulting all the way to `http://localhost:9200`) —
  // would mean a deployment that genuinely enabled `logger.elastic` but forgot to import
  // `@zanix/datamaster/core` starts silently writing logs into a black hole, instead of failing
  // loud at the one point where the real cause is still visible.
  // `'search'` is a real, unconditionally-registered core slot (see `observability/core.ts`) —
  // this only throws when no connector was ever actually configured/registered for it.
  const connector = ProgramModule.getConnectors(undefined, false).get<
    ZanixElasticsearchConnector
  >('search')

  return wireIndexInitialize(connector, indexInitialize, connectorOptions)
}
