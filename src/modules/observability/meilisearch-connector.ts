import type {
  BulkIndexResult,
  MeilisearchConnectorOptions,
  MeilisearchTask,
} from './typings/general.ts'

import { InternalError } from '@zanix/errors'
import { ZanixSearchConnector } from '@zanix/server'
import { SEARCH_URL_ENV } from './search-config.ts'

const DEFAULT_HOST = 'http://localhost:7700'
const DEFAULT_INDEX = 'zanix-logs'
const DEFAULT_POLL_INTERVAL_MS = 200
const DEFAULT_POLL_TIMEOUT_MS = 10_000
const TERMINAL_STATUSES = new Set<MeilisearchTask['status']>(['succeeded', 'failed', 'canceled'])

/** Env var name for the Meilisearch API key. */
export const MEILISEARCH_API_KEY_ENV = 'MEILISEARCH_API_KEY'

const resolveHost = (host?: string): string => host || Deno.env.get(SEARCH_URL_ENV) || DEFAULT_HOST

const resolveApiKey = (apiKey?: string): string | undefined =>
  apiKey || Deno.env.get(MEILISEARCH_API_KEY_ENV)

const authHeaders = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

/**
 * Connector for [Meilisearch](https://www.meilisearch.com), over a plain `fetch`-based `RestClient`
 * rather than a vendor SDK — the same "least product-differentiated part of the wire protocol"
 * approach `ZanixElasticsearchConnector` (`./connector.ts`) already follows, applied to Meilisearch's
 * own real REST API instead (verified directly against Meilisearch's API reference/self-hosting docs
 * — see this class's individual method docs for what was actually confirmed and where).
 *
 * Meilisearch's document-write API has **no distinct single-vs-bulk endpoint the way Elasticsearch
 * does** (`_doc` vs `_bulk`): `POST /indexes/{index_uid}/documents` accepts a JSON array and is used
 * for both a single document (`index()`, wrapping it in a one-element array) and many (`bulkIndex()`,
 * the array as given) — confirmed against Meilisearch's own "Getting started with indexing" guide,
 * which states this endpoint "handles both single and batch document submissions".
 *
 * Meilisearch also auto-creates the target index the first time documents are written to it
 * (confirmed against Meilisearch's own docs/integration guides) — unlike Elasticsearch/OpenSearch,
 * where `ensureIndex()` exists specifically because some settings can only be set at creation time.
 * There is deliberately no `ensureIndex()`-equivalent here.
 *
 * Extends `@zanix/server`'s `ZanixSearchConnector`, the abstract base for the `'search'` core
 * connector category — this is what makes `@Connector({slot: 'search'})` registration valid (see
 * `core.ts`). `'search'` is a single core-connector slot, not independently-coexisting instances the
 * way `@zanix/auth`'s OAuth2 providers are — `SEARCH_ENGINE=meilisearch` (`search-config.ts`) is
 * what selects this connector for the slot, so only one engine is ever configured at a time.
 *
 * @extends ZanixSearchConnector
 */
export class MeilisearchConnector extends ZanixSearchConnector {
  /** Default index name (or per-document resolver) used when a call doesn't specify one. */
  #defaultIndex: string | ((doc: Record<string, unknown>) => string)
  /** `primaryKey` query param appended to document-write requests, if configured. */
  #primaryKey?: string
  #waitForTask: boolean
  #pollIntervalMs: number
  #pollTimeoutMs: number

  /**
   * Creates the connector, resolving the instance URL/API key (option, then env var, then default —
   * see `resolveHost`/`resolveApiKey`) and building the resulting `Authorization: Bearer` header.
   *
   * @param options - Connection options — `host`/`index`/`apiKey`/task-polling knobs plus the base
   * `ConnectorOptions` (`contextId`, `autoInitialize`) `RestClient` already accepts.
   */
  constructor(options: MeilisearchConnectorOptions = {}) {
    const {
      host,
      apiKey,
      index = {},
      waitForTask = true,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
      ...connectorOptions
    } = options
    super({
      ...connectorOptions,
      baseUrl: resolveHost(host),
      headers: authHeaders(resolveApiKey(apiKey)),
    })
    this.#defaultIndex = index.name ?? DEFAULT_INDEX
    this.#primaryKey = index.primaryKey
    this.#waitForTask = waitForTask
    this.#pollIntervalMs = pollIntervalMs
    this.#pollTimeoutMs = pollTimeoutMs
  }

  /** Resolves the target index name for a given document, per the `index` option/argument. */
  #indexFor(doc: Record<string, unknown>, index?: string): string {
    if (index) return index
    return typeof this.#defaultIndex === 'function' ? this.#defaultIndex(doc) : this.#defaultIndex
  }

  /** `POST /indexes/{index}/documents` path, with `primaryKey` appended as a query param when
   * configured — confirmed against Meilisearch's own docs (`?primaryKey=...`, needed only when a
   * document's primary-key field isn't named `id`). */
  #documentsPath(index: string): string {
    const base = `indexes/${index}/documents`
    return this.#primaryKey ? `${base}?primaryKey=${encodeURIComponent(this.#primaryKey)}` : base
  }

  /**
   * Indexes a single document via `POST /indexes/{index}/documents`, the body wrapped in a
   * one-element array — Meilisearch has no separate single-document endpoint (see this class's own
   * doc). Resolves once the write is enqueued, mirroring `ZanixElasticsearchConnector.index()`'s own
   * "don't wait for visibility" contract (there, the next auto-refresh cycle; here, task completion)
   * — `index()`'s contract is `Promise<void>`, so there's no result to make meaningful by waiting.
   */
  public override async index(
    doc: Record<string, unknown>,
    opts: { index?: string } = {},
  ): Promise<void> {
    const index = this.#indexFor(doc, opts.index)
    await this.http.post(this.#documentsPath(index), { body: JSON.stringify([doc]) })
  }

  /**
   * Bulk-indexes documents via `POST /indexes/{index}/documents`, the whole array as the body — the
   * SAME endpoint `index()` uses (see this class's own doc), never a distinct `_bulk`-shaped one.
   *
   * Documents are grouped by their resolved target index (relevant when `index.name` is a
   * per-document resolver function) and one request is issued per group — Meilisearch's endpoint is
   * scoped to a single index per call, unlike Elasticsearch's `_bulk`, which can target different
   * indices within one NDJSON body via each line's own `_index`.
   *
   * Meilisearch's write is asynchronous (an enqueued task, not an inline per-item result) — when
   * `waitForTask` is enabled (the default), each group's task is polled via `GET /tasks/{taskUid}`
   * until it reaches a terminal status, so the returned `{errors, failedCount}` reflects what
   * actually happened rather than just "the request was accepted". Meilisearch's own task API
   * doesn't publicly document the exact field names inside a `documentAdditionOrUpdate` task's
   * `details` for a failed task — this reads `details.indexedDocuments` opportunistically when
   * present (computing `docs.length - indexedDocuments`), and otherwise treats the WHOLE group as
   * failed (`docs.length`) on a `failed` terminal status — the conservative assumption, since
   * Meilisearch's task failures are reported per-task, not per-document the way Elasticsearch's
   * `items[].error` is.
   *
   * @throws If `waitForTask` is enabled and a group's task doesn't reach a terminal status within
   * `pollTimeoutMs` — a timeout throws rather than guessing a result; the task may still resolve
   * either way after the window closes, and reporting an outcome without knowing it would be
   * fabricated, not real.
   */
  public override async bulkIndex(
    docs: Record<string, unknown>[],
    opts: { index?: string } = {},
  ): Promise<BulkIndexResult> {
    if (!docs.length) return { errors: false, failedCount: 0 }

    const groups = new Map<string, Record<string, unknown>[]>()
    for (const doc of docs) {
      const index = this.#indexFor(doc, opts.index)
      const group = groups.get(index)
      if (group) group.push(doc)
      else groups.set(index, [doc])
    }

    const results = await Promise.all(
      [...groups.entries()].map(([index, group]) => this.#bulkIndexGroup(index, group)),
    )

    return results.reduce(
      (acc, result) => ({
        errors: acc.errors || result.errors,
        failedCount: acc.failedCount + result.failedCount,
      }),
      { errors: false, failedCount: 0 },
    )
  }

  /** Writes one index-group and, when `waitForTask` is enabled, polls it to a terminal status. */
  async #bulkIndexGroup(
    index: string,
    docs: Record<string, unknown>[],
  ): Promise<BulkIndexResult> {
    const task = await this.http.post<MeilisearchTask>(this.#documentsPath(index), {
      body: JSON.stringify(docs),
    })

    if (!this.#waitForTask) return { errors: false, failedCount: 0 }

    const finalTask = await this.#pollTask(task.taskUid)
    if (finalTask.status !== 'failed') return { errors: false, failedCount: 0 }

    const indexed = finalTask.details?.indexedDocuments
    const failedCount = typeof indexed === 'number' ? docs.length - indexed : docs.length
    return { errors: true, failedCount }
  }

  /**
   * Polls `GET /tasks/{taskUid}` until its `status` reaches a terminal value, per `pollIntervalMs`/
   * `pollTimeoutMs`.
   */
  async #pollTask(taskUid: number): Promise<MeilisearchTask> {
    const deadline = Date.now() + this.#pollTimeoutMs
    for (;;) {
      // Inherently sequential — each poll must observe the RESULT of waiting out the previous
      // interval, so there's nothing here for `Promise.all` to parallelize.
      // deno-lint-ignore no-await-in-loop
      const task = await this.http.get<MeilisearchTask>(`tasks/${taskUid}`)
      if (TERMINAL_STATUSES.has(task.status)) return task

      if (Date.now() >= deadline) {
        // A native `Error` here previously — a downstream service (Meilisearch) not finishing a
        // task in time is exactly the "caller had no control over it" case `InternalError` is for.
        throw new InternalError(
          `[MeilisearchConnector] task ${taskUid} did not reach a terminal status within ` +
            `${this.#pollTimeoutMs}ms (last seen status: "${task.status}")`,
          { code: 'MEILISEARCH_TASK_POLL_TIMEOUT', meta: { taskUid, lastStatus: task.status } },
        )
      }

      // Same rationale as the poll request above — a deliberate wait between sequential polls.
      // deno-lint-ignore no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, this.#pollIntervalMs))
    }
  }

  /**
   * Pings the instance via `GET /health` — confirmed against Meilisearch's own API reference:
   * responds `{ status: "available" }` (`200`) when healthy, `{ status: "mustRestart" }` otherwise.
   * Not an `isHealthy()` override, for the same reason `ZanixElasticsearchConnector.
   * checkClusterHealth()` isn't one: `RestClient`'s own `isHealthy()` is synchronous `boolean`, so a
   * real network probe needs its own, explicitly-awaited method.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const result = await this.http.get<{ status: string }>('health')
      return result.status === 'available'
    } catch {
      return false
    }
  }
}
