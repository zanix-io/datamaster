import type { BulkIndexResult, ElasticsearchConnectorOptions } from './typings/general.ts'

import { ZanixElasticsearchConnector } from './connector.ts'

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
 * instance, which isn't cloneable across the postMessage boundary) and reconstructs a throwaway
 * connector inside the worker to perform the write — constructed directly here, deliberately NOT
 * via `getConnector()`: a worker thread's own `ProgramModule` DI state starts fresh every time
 * (nothing from the main thread's registry carries over across the `postMessage` boundary), so
 * checking the shared `'search'` registry from inside a worker can never succeed — `getConnector()`
 * would just throw immediately every single call, for a reason that isn't a real misconfiguration
 * here. Always constructing standalone, from the options this function was explicitly given, is
 * the only correct behavior in this context.
 */
export function flushBulkInWorker(
  connectorOptions: ElasticsearchConnectorOptions,
  docs: Record<string, unknown>[],
): Promise<BulkIndexResult> {
  const connector = new ZanixElasticsearchConnector(connectorOptions)
  return connector.bulkIndex(docs)
}
