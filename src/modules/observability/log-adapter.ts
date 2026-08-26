import type { BaseFormattedLog } from '@zanix/types'
import type {
  ElasticsearchConnectorOptions,
  ElasticsearchLogSaveFunction,
  ElasticsearchLogSaveOptions,
} from './typings/general.ts'

import logger from '@zanix/logger'
import { BulkBuffer } from './bulk-buffer.ts'
import { getConnector, wireIndexInitialize, type ZanixElasticsearchConnector } from './connector.ts'
import { flushBulkInWorker, workerFlushMetaUrl } from './worker-flush.ts'
import { dispatchWorkerTask } from '@zanix/server'

/**
 * Aliases the formatted log's own timestamp to `@timestamp` — the field Kibana/OpenSearch
 * Dashboards look for by default — without ever overwriting an already-present `@timestamp`
 * (a fully custom formatter may already set one itself) or renaming/removing the original field.
 * Only synthesizes a fresh timestamp when neither is present (a custom formatter that keeps no
 * time field at all). See `docs/logger.md`'s "Building a reusable storage backend" section in
 * `@zanix/utils` for the reasoning behind aliasing instead of always generating a new one.
 */
const withTimestamp = (log: BaseFormattedLog): Record<string, unknown> => {
  if (typeof log['@timestamp'] === 'string') return log
  const timestamp = typeof log.timestamp === 'string' ? log.timestamp : new Date().toISOString()
  return { ...log, '@timestamp': timestamp }
}

/**
 * Reports a failed flush via `logger.error(..., 'noSave')` — the `'noSave'` sentinel prints
 * through the Logger's own branded console output but skips its storage layer entirely (same
 * precedent `RedisPipelineScheduler`'s own flush-error reporting already uses). This matters here
 * specifically: if this same `logger` is the one configured with `elasticsearchLogSave` and
 * Elasticsearch/OpenSearch is unreachable, reporting the failure through the *persisted* log path
 * would buffer a self-generated error log that itself fails to flush next time around, forever
 * regenerating one more error log per failed attempt — `'noSave'` avoids that loop entirely.
 */
const reportFlushFailure = (context: string, error: unknown): void => {
  logger.error(
    `[elasticsearchLogSave] Failed to flush logs to Elasticsearch/OpenSearch (${context}):`,
    error,
    'noSave',
  )
}

/**
 * Flushes a batch on the main thread, logging (never throwing) on failure — including a failure
 * to even RESOLVE a connector. `getConnector()` now throws (no silent fallback construction —
 * see its own doc) when nothing is registered under `'search'`, which a naive `connector ||
 * getConnector(connectorOptions)` would let escape synchronously, breaking this function's own
 * "never throws" contract (real regression, caught by this file's own test suite before
 * shipping: `elasticsearchLogSave` is a fire-and-forget `SaveDataFunction`, called from
 * arbitrary logging call sites that never expect it to throw). Wrapped the same way a
 * `bulkIndex()` rejection already is.
 *
 * A caller-supplied `connector` skips `getConnector()` entirely (that's the whole point of
 * `connector` — reuse an already-constructed instance instead of resolving/building one). Since
 * `wireIndexInitialize` is called directly on `connector` here too, the same way `getConnector()`
 * calls it internally, `indexInitialize` works identically regardless of which of the two
 * `connector` reaches this function.
 *
 * `bulkIndex()` is always called with an explicit `index` override sourced from
 * `connectorOptions.index?.name`. This matters specifically for the `getConnector()` branch: the
 * shared `'search'` singleton is constructed once, by `@zanix/server`'s DI container, from a
 * synthetic per-lifetime context id — never from any one `elasticsearchLogSave()` caller's real
 * options — so its own `#defaultIndex` permanently defaults to `'zanix-logs'` regardless of what
 * any individual caller configures. Without an explicit per-call override, a write through that
 * shared connector would always land on its own default index instead of this caller's configured
 * one, even though `connectorOptions.index?.name` was already reaching `ensureIndex()`'s
 * settings/mappings via `wireIndexInitialize`. Passing the override here makes the actual write
 * target agree with whatever `ensureIndex()` is already ensuring.
 *
 * Passing this override is also always safe for a caller-supplied `connector` (the other branch
 * above): that connector was already constructed directly from these same options, so its own
 * `#defaultIndex` already resolves to the same value this override forwards — a redundant,
 * behavior-preserving no-op there, not a special case to branch around.
 *
 * This is a per-call override, not a mutation of the shared connector's own `#defaultIndex` —
 * deliberately, since `'search'` is one process-wide singleton and more than one
 * `elasticsearchLogSave()` caller (e.g. two independent `Logger` instances, each with its own
 * `index.name`) can realistically share it in the same process; mutating shared state on the
 * connector itself would make the last caller's index silently win for every other caller
 * instead. `opts.index` accepts the same shape `#defaultIndex` does (a static name or a
 * per-document resolver — see `bulkIndex()`'s own doc), so a per-document resolver configured
 * here is honored too, not just a static index name.
 */
const flushInline = (
  connector: ZanixElasticsearchConnector | undefined,
  connectorOptions: ElasticsearchConnectorOptions & {
    indexInitialize?: boolean
  },
  docs: Record<string, unknown>[],
): Promise<void> => {
  let conn: ZanixElasticsearchConnector
  try {
    conn = connector
      ? wireIndexInitialize(connector, connectorOptions.indexInitialize, connectorOptions)
      : getConnector(connectorOptions)
  } catch (e) {
    reportFlushFailure('inline', e)
    return Promise.resolve()
  }
  return conn.bulkIndex(docs, { index: connectorOptions.index?.name }).then(
    () => {},
    (e) => reportFlushFailure('inline', e),
  )
}
/** Flushes a batch inside a worker thread — see `worker-flush.ts` and `@zanix/server`'s
 * `dispatchWorkerTask` for the `'one-time'`/`'persisted'` dispatch strategies themselves. */
const flushViaWorker = (
  connectorOptions: ElasticsearchConnectorOptions & {
    indexInitialize?: boolean
  },
  worker: 'one-time' | 'persisted',
  docs: Record<string, unknown>[],
): Promise<void> =>
  new Promise((resolve) => {
    dispatchWorkerTask(flushBulkInWorker, {
      mode: worker,
      metaUrl: workerFlushMetaUrl,
      verbose: false,
      callback: ({ error }) => {
        if (error) reportFlushFailure('worker', error)
        resolve()
      },
    })(connectorOptions, docs)
  })

/**
 * `@zanix/logger` `storage.save` factory that persists logs to Elasticsearch/OpenSearch — the
 * one file in this package that imports `@zanix/logger`'s own types. Buffers formatted logs in
 * memory and flushes them via `_bulk` on a size-or-time threshold (see `BulkBuffer`), instead of
 * one HTTP round trip per log call.
 *
 * A log call resolves as soon as its formatted document is buffered, not once it's actually sent
 * — the same fire-and-forget contract `@zanix/logger`'s own `SaveDataFunction` already has.
 * Buffered-but-unflushed logs are lost on an abrupt process exit; the returned function has its
 * own `flush()` attached (unrelated to `Logger`, which only ever calls it as a plain function) for
 * a graceful-shutdown hook to send whatever's currently buffered ahead of its next scheduled flush.
 *
 * @param options - Connection, indexing, and buffering configuration. `node`/`auth`/`index` are
 * forwarded to a new {@link ZanixElasticsearchConnector} unless `connector` reuses an existing one.
 *
 * @example
 * ```ts
 * import { Logger } from 'jsr:@zanix/utils@[version]/logger'
 * import { elasticsearchLogSave } from 'jsr:@zanix/datamaster@[version]/observability'
 *
 * const save = elasticsearchLogSave({ node: 'https://es.internal:9200', index: 'app-logs' })
 * const logger = new Logger({ storage: { save } })
 *
 * // In a graceful-shutdown hook:
 * await save.flush()
 * ```
 */
export function elasticsearchLogSave(
  options: ElasticsearchLogSaveOptions = {},
): ElasticsearchLogSaveFunction {
  const {
    bulk,
    connector,
    addTimestampField = true,
    useWorker,
    ...connectorOptions
  } = options

  const buffer = new BulkBuffer<Record<string, unknown>>(
    (docs) =>
      useWorker
        ? flushViaWorker(connectorOptions, useWorker, docs)
        : flushInline(connector, connectorOptions, docs),
    bulk,
  )

  const save: ElasticsearchLogSaveFunction = (context) => {
    const log = context.getFmtLog<BaseFormattedLog>()
    buffer.push(addTimestampField ? withTimestamp(log) : log)
    return Promise.resolve()
  }
  save.flush = () => buffer.flush()

  return save
}
