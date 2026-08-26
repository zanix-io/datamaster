import type { BulkIndexResult, ElasticsearchConnectorOptions } from './typings/general.ts'

import { wireIndexInitialize, ZanixElasticsearchConnector } from './connector.ts'

/**
 * This file's own URL, passed as `metaUrl` to `WorkerManager.task(...)` so the worker thread can
 * dynamically re-import this exact module and look up `flushBulkInWorker` by name — the same
 * mechanism `@zanix/logger`'s own file-storage `useWorker` option uses.
 */
export const workerFlushMetaUrl = import.meta.url

/**
 * Runs a single bulk-index call inside a `WorkerManager` worker thread — used only when
 * `elasticsearchLogSave`'s `useWorker: true` dispatches its periodic flush off the main thread.
 *
 * Takes plain, structured-cloneable connection config (never a live `ZanixElasticsearchConnector`
 * instance, which isn't cloneable across the postMessage boundary — `elasticsearchLogSave`'s own
 * `connector` option is typed `never` whenever `useWorker` is set, so a caller-supplied connector
 * can never reach this function at all) and reconstructs a throwaway connector inside the worker
 * to perform the write — constructed directly here, deliberately NOT via `getConnector()`: a
 * worker thread's own `ProgramModule` DI state starts fresh every time (nothing from the main
 * thread's registry carries over across the `postMessage` boundary), so checking the shared
 * `'search'` registry from inside a worker can never succeed — `getConnector()` would just throw
 * immediately every single call, for a reason that isn't a real misconfiguration here. Always
 * constructing standalone, from the options this function was explicitly given, is the only
 * correct behavior in this context.
 *
 * `indexInitialize` is honored the same way `getConnector()`'s own resolution honors it (via
 * {@link wireIndexInitialize}) — but since a fresh connector is constructed on every single call
 * here (there's no cross-flush singleton to memoize against inside a worker, unlike the main
 * thread's reused `'search'` core connector), `ensureIndex()`'s idempotent `HEAD` check re-runs on
 * every worker-dispatched flush rather than once for the connector's lifetime. Still correct (an
 * existing index is never touched, so repeating the check is safe) — just a real, structural
 * difference from the main-thread memoized behavior worth knowing about, not a regression.
 */
export function flushBulkInWorker(
  connectorOptions: ElasticsearchConnectorOptions & { indexInitialize?: boolean },
  docs: Record<string, unknown>[],
): Promise<BulkIndexResult> {
  const { indexInitialize, ...options } = connectorOptions
  const connector = wireIndexInitialize(
    new ZanixElasticsearchConnector(options),
    indexInitialize,
    options,
  )
  return connector.bulkIndex(docs)
}
