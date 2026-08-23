# Observability

Search-engine connectors for the `'search'` core connector slot, plus Elasticsearch/OpenSearch
persistence for [`@zanix/logger`](https://jsr.io/@zanix/utils/doc/logger) (`elasticsearchLogSave`).
Two connectors are available — `ZanixElasticsearchConnector` (Elasticsearch OSS/Free/OpenSearch) and
`MeilisearchConnector` — backing the SAME single `'search'` slot; `SEARCH_ENGINE` selects exactly
one per deployment (see "Selecting a search engine" below). Everything here lives under the
`./observability` subpath — it's never re-exported from the package root, so a consumer who doesn't
import it pays zero cost and Logger stays fully independent of DataMaster.

```ts
import { elasticsearchLogSave } from 'jsr:@zanix/datamaster@[version]/observability'
import { Logger } from 'jsr:@zanix/utils@[version]/logger'

const logger = new Logger({
  storage: {
    save: elasticsearchLogSave({
      node: 'https://es.internal:9200',
      index: { name: 'app-logs' },
    }),
  },
})
```

## `ZanixElasticsearchConnector`

A plain `fetch`-based connector for Elasticsearch OSS, Elasticsearch (Free tier), and OpenSearch —
no vendor SDK. It only uses the most stable, least product-differentiated part of the wire protocol
across all three (`_doc`, `_bulk`, `_cluster/health`), which sidesteps both
`@elastic/elasticsearch`'s product-check friction against non-Elastic servers and
`@opensearch-project/opensearch`'s lack of official support against real Elasticsearch.

```ts
import { ZanixElasticsearchConnector } from 'jsr:@zanix/datamaster@[version]/observability'

const es = new ZanixElasticsearchConnector({
  node: Deno.env.get('SEARCH_URL'), // falls back to SEARCH_URL, then http://localhost:9200
  index: {
    name: 'app-logs', // or a per-document resolver: (doc) => `app-logs-${doc.level}`
    settings: { number_of_shards: 1, number_of_replicas: 0 }, // used by ensureIndex(), see below
    mappings: { properties: { level: { type: 'keyword' } } },
  },
  auth: { username: 'elastic', password: '...' }, // or { apiKey: '...' }
})

await es.index({ message: 'hello' }) // POST /{index}/_doc
await es.bulkIndex([{ a: 1 }, { a: 2 }]) // POST /_bulk (NDJSON)
await es.checkClusterHealth() // GET /_cluster/health — true/false, never throws
```

It operates on plain `Record<string, unknown>` documents — it has no knowledge of Logger's formatted
log shape, so it's equally usable to index any document, not just logs. Both `index()` and
`bulkIndex()` accept a per-call `{ index }` that overrides the connector-level default for that one
call.

### Auth: URL-embedded vs. env var

Basic auth can be embedded directly in the URL instead of the `auth` option —
`https://user:pass@host:9200` — since `fetch` honors userinfo in a URL and sends it as a real
`Authorization: Basic` header (verified directly against this connector, not assumed). This means
Basic auth already has a full zero-config env var path today: just put the credentials in
`SEARCH_URL` itself, no separate username/password env vars needed.

API-key auth has no URL equivalent — there's no standard syntax for an arbitrary header value like
an API key — so it falls back to `ELASTICSEARCH_API_KEY`, then `OPENSEARCH_API_KEY`, when the `auth`
option is omitted, mirroring `node`'s own env var precedence.

`bulkIndex()` responds `200` even when individual documents fail (e.g. a mapping conflict) — the
returned `{ errors, failedCount }` is computed by inspecting `items[].error` in the response body,
never by relying on the request not having thrown.

There's no `isHealthy()` override: `RestClient`'s own `isHealthy()` is synchronous `boolean` (a REST
client has no persistent connection state to check), so a real network probe can't be expressed
through that signature. `checkClusterHealth()` is a separate, explicitly-awaited method for callers
who want to verify the cluster is actually reachable.

### Creating an index with `ensureIndex()`

By default, Elasticsearch/OpenSearch auto-creates an index the first time a document is written to
it, with whatever dynamic mapping it infers from that document — fine for quick prototyping, but
some settings (shard count, for example) can only be set at creation time, so relying on auto-create
locks in defaults you may not want. `ensureIndex()` lets you control that explicitly:

```ts
await es.ensureIndex('app-logs') // HEAD /app-logs — creates it via PUT only if missing, else a no-op
await es.ensureIndex('app-logs', {
  settings: { number_of_shards: 3 }, // overrides the connector-level index.settings for this call
  mappings: { properties: { level: { type: 'keyword' } } },
})
await es.ensureIndex(['app-logs-error', 'app-logs-info']) // checks/creates each, deduped
```

It's a `HEAD` existence check followed by a `PUT` (with `settings`/`mappings` from the
connector-level `index` option, or the per-call `opts` override) only when the index is missing — an
existing index is never touched, so this never overwrites settings/mappings on one that's already
there. Pass an array to check/create several indexes at once (e.g. every index a per-document
resolver might produce) — repeated names are deduped before checking.

Rather than calling `ensureIndex()` by hand before the first write, set `index.name` to a **static**
string and pass `indexInitialize: true` to `elasticsearchLogSave` (see below) to have every
`index()`/`bulkIndex()`/`refresh()` call await it automatically — each such call re-runs
`ensureIndex`'s `HEAD` check (a `PUT` only ever happens once the index genuinely doesn't exist yet),
so this trades a small, ongoing per-call `HEAD` request for never having to reason about ordering
the first write after index creation yourself.

### Querying with `search()`

```ts
const result = await es.search<{ hits: { total: { value: number } } }>({
  query: { match: { message: 'timeout' } },
}) // POST /{index}/_search, or a cluster-wide POST /_search if no index can be resolved
```

Unlike `index`/`bulkIndex`, `search()` is deliberately untyped on its `query` argument — it's a raw
Elasticsearch/OpenSearch Query DSL body, passed straight through rather than wrapped in an
abstraction that would just reinvent it (the DSL itself is the reason to reach for `search()`
instead of `index`/`bulkIndex`). Only the response is generic (`search<T>`), since callers always
know the shape of what they asked for. It's intentionally **not** part of `@zanix/server`'s
`ZanixSearchConnector` abstract base — that contract only covers `index`/`bulkIndex`, which take a
plain document object that's genuinely comparable across any indexing backend; a query DSL isn't
(Elasticsearch's differs completely from, say, Algolia's or Meilisearch's), so forcing one directly
onto the shared abstraction would be misleading rather than useful.

One easy trap when writing a query: a string field with no explicit mapping is dynamically mapped as
analyzed `text`, with a `.keyword` sub-field alongside it for exact matches — a `term` query against
the plain field name searches the analyzed tokens, not the raw string, so an exact match on, say, a
UUID needs `{ term: { 'myField.keyword': value } }` instead.

### Forcing visibility with `refresh()`

```ts
await es.index({ message: 'hello' })
await es.refresh() // POST /{index}/_refresh — same index-resolution rules as search()
const result = await es.search({ query: { match_all: {} } }) // now sees the document above
```

By default, a newly indexed document only becomes searchable on the next automatic refresh cycle
(near-real-time, ~1s). `refresh()` forces it immediately — mainly useful for tests and genuine
read-your-own-write scenarios. **Avoid calling it after every write in a production hot path**:
forcing a refresh triggers extra segment work and can hurt indexing throughput under load, and log
data typically doesn't need stronger-than-near-real-time visibility.

## `MeilisearchConnector`

A plain `fetch`-based connector for [Meilisearch](https://www.meilisearch.com) — no vendor SDK, the
same rationale as `ZanixElasticsearchConnector` above, applied to Meilisearch's own real REST API
(verified directly against Meilisearch's docs, not assumed).

```ts
import { MeilisearchConnector } from 'jsr:@zanix/datamaster@[version]/observability'

const meili = new MeilisearchConnector({
  host: Deno.env.get('SEARCH_URL'), // falls back to SEARCH_URL, then http://localhost:7700
  apiKey: '...', // falls back to MEILISEARCH_API_KEY; sent as `Authorization: Bearer {apiKey}`
  index: {
    name: 'app-logs', // or a per-document resolver: (doc) => `app-logs-${doc.level}`
    primaryKey: 'uuid', // only needed when a document's primary-key field isn't named `id`
  },
})

await meili.index({ message: 'hello' }) // POST /indexes/{index}/documents, body: [doc]
await meili.bulkIndex([{ a: 1 }, { a: 2 }]) // POST /indexes/{index}/documents, body: the array as-is
await meili.checkHealth() // GET /health — true/false, never throws
```

### No distinct bulk endpoint, unlike Elasticsearch's `_bulk`

`index()` and `bulkIndex()` hit the exact same endpoint — `POST /indexes/{index_uid}/documents`,
which Meilisearch's own "Getting started with indexing" guide describes as handling "both single and
batch document submissions" identically. `index()` just wraps its one document in a one-element
array; there's no NDJSON, no per-line `_index` action — the whole array is the body.

A `bulkIndex()` call whose `index.name` is a per-document resolver function still issues one request
**per distinct resolved index** (grouped, not one call per document) — Meilisearch's endpoint is
scoped to a single index per request, unlike Elasticsearch's `_bulk`, which can mix target indices
within one NDJSON body.

Meilisearch also auto-creates the target index the first time documents are written to it — unlike
Elasticsearch/OpenSearch, there's no `ensureIndex()`-equivalent here, since there are no
creation-time-only settings (shard count, etc.) to lock in ahead of time.

### `bulkIndex()`'s result is real, not guessed — because it polls

Meilisearch's document-write API is fundamentally **asynchronous**: every write enqueues a task and
the response comes back immediately with `status: "enqueued"` — it never reports success/failure
inline the way Elasticsearch's `_bulk` does. To make `bulkIndex()`'s `{errors, failedCount}` return
value actually mean something, it polls `GET /tasks/{taskUid}` (per resolved-index group) until each
task reaches a terminal status (`succeeded`/`failed`/`canceled`), controlled by two options:

```ts
const meili = new MeilisearchConnector({
  waitForTask: true, // default — poll to a terminal status before resolving
  pollIntervalMs: 200, // default
  pollTimeoutMs: 10_000, // default; a task still pending after this throws, rather than guessing
})
```

Set `waitForTask: false` for fire-and-forget semantics instead (no polling latency) — in that case
`bulkIndex()` always resolves `{errors: false, failedCount: 0}` once the write is accepted,
regardless of what actually happens to the task afterward. `index()` never polls at all — its
contract is `Promise<void>`, so there's no result to make meaningful by waiting.

Meilisearch's task API doesn't publicly document the exact field names inside a
`documentAdditionOrUpdate` task's `details` for a **failed** task. When a task fails, `bulkIndex()`
reads `details.indexedDocuments` opportunistically (computing `failedCount` as the difference from
the group's size) when that field is present, and otherwise conservatively treats the **whole
group** as failed — Meilisearch reports failures per-task, not per-document the way Elasticsearch's
`items[].error` does, so that's the honest worst-case assumption, not an undercount.

## `elasticsearchLogSave`

The bridge to `Logger`'s `storage.save` extension point. It's a **factory function** — you call it
with plain configuration and it **returns** a `SaveDataFunction`, so from Logger's perspective the
result is indistinguishable from handwriting `storage: { save: (context) => {...} }` yourself, just
pre-packaged so you don't have to reimplement buffering/bulk/timestamp handling. This is
deliberately not the plain-object shape Logger's own file-based storage recognizes
(`storage: { save: { folder, expirationTime, ... } }`) — that shape is a special case Logger itself
owns because file storage is its own built-in default; teaching Logger to also recognize
Elasticsearch-shaped config would mean `@zanix/utils` learning about a specific external service,
which is exactly what this design avoids. See `@zanix/utils`'s
[Building a reusable storage backend](https://jsr.io/@zanix/utils/doc/logger#6-building-a-reusable-storage-backend)
for the general pattern this follows.

```ts
const save = elasticsearchLogSave({
  node: 'https://es.internal:9200',
  index: { name: 'app-logs' },
  bulk: { maxSize: 100, flushIntervalMs: 5000 }, // defaults shown
  addTimestampField: true, // default; see "Timestamp handling" below
  indexInitialize: false, // default; see "Creating an index with ensureIndex()" above
  useWorker: undefined, // default (main thread); 'one-time' | 'persisted', see below
  connector: undefined, // reuse an existing ZanixElasticsearchConnector — main thread only
})

const logger = new Logger({ storage: { save } })

// In a graceful-shutdown hook, to send whatever's currently buffered ahead of schedule:
await save.flush()
```

`connector`/`useWorker` are mutually exclusive by type, not just by convention:
`ElasticsearchLogSaveOptions` is a discriminated union on `useWorker`, and either worker variant
(`'one-time'`/`'persisted'`) types `connector` as `never` — reusing a live connector instance across
the `postMessage` boundary a worker thread requires isn't possible (see "Offloading the flush to a
worker" below), so passing both is a compile-time error, not just a runtime one.

A log call resolves as soon as its formatted document is buffered, not once it's actually sent — the
same fire-and-forget contract Logger's own `SaveDataFunction` already has. Buffered-but-unflushed
logs are lost on an abrupt process exit; mitigate with a short `flushIntervalMs` and/or the
`flush()` escape hatch shown above.

A flush failure (the cluster is unreachable, a bad request, etc.) is reported via
`logger.error(..., 'noSave')` — printed through Logger's own branded console output, but explicitly
skipping the storage layer. This matters specifically when `logger` here is the same instance
configured with `elasticsearchLogSave`: reporting the failure through the _persisted_ path would
buffer a self-generated error log that itself fails to flush next time, regenerating one more error
log per failed attempt, forever. `'noSave'` avoids that loop entirely. It never throws back to the
original caller.

### Timestamp handling

`@zanix/logger`'s default formatter already produces a `timestamp` field (an ISO string). Kibana and
OpenSearch Dashboards, however, look for `@timestamp` by default. Rather than blindly generating a
new one, `elasticsearchLogSave` aliases whatever the formatted log already carries:

- If `@timestamp` is already present (a fully custom formatter set it itself), it's left untouched.
- Otherwise, if `timestamp` is present (the default formatter, or a custom one that keeps that
  name), its value is **copied** to `@timestamp` — the original `timestamp` field is never renamed
  or removed.
- Only if neither field is present at all (a custom formatter with no time field whatsoever) is a
  fresh `new Date().toISOString()` synthesized at send time.

Set `addTimestampField: false` to skip this entirely — in that case, configure your index's "time
field" in Kibana/OpenSearch Dashboards to point at `timestamp` (or your custom formatter's
equivalent field) instead of `@timestamp`.

### Offloading the flush to a worker

`useWorker: 'one-time' | 'persisted'` dispatches each periodic `bulkIndex` call to a `WorkerManager`
worker thread instead of running it inline on the main thread. This only ever applies to the batched
flush, never to an individual log call — applying it per-log would defeat buffering entirely (every
dispatch would spin up a worker with no shared state). Either mode reconstructs a throwaway
connector inside the worker from plain, structured-cloneable connection options (never a live
connector instance, and never the app's own DI-registered `'search'` connector — neither can cross
the `postMessage` boundary).

- **`'one-time'`**: spins up a fresh worker for each flush and closes it once the flush completes —
  the same one-time-worker behavior `@zanix/logger`'s own file-storage `useWorker` option uses.
- **`'persisted'`**: reuses a single long-lived worker pool across flushes instead of paying worker
  startup cost on every one, via `@zanix/server`'s `'worker'` core provider
  (`ZanixWorkerProvider#executeGeneralTask`) — available only inside a booted Zanix Core
  application. Outside one (that provider isn't registered), it transparently falls back to the
  `'one-time'` behavior instead of throwing, so `'persisted'` is always safe to set regardless of
  runtime.

```ts
const save = elasticsearchLogSave({
  node: 'https://es.internal:9200',
  useWorker: 'persisted', // falls back to 'one-time' outside a Zanix Core app
})
```

## Zero-config registration

Importing `jsr:@zanix/datamaster@[version]/core` registers a connector with the Zanix DI container
for whichever backend `SEARCH_ENGINE` selects — mirroring how the Mongo/Redis/SQLite core connectors
register themselves. It registers under `@zanix/server`'s `'search'` core connector type, backed by
the `ZanixSearchConnector` abstract base both connector classes extend:

```sh
SEARCH_ENGINE=elasticsearch   # or 'opensearch' — both select ZanixElasticsearchConnector
SEARCH_URL=https://es.internal:9200
```

```sh
SEARCH_ENGINE=meilisearch     # selects MeilisearchConnector
SEARCH_URL=https://meili.internal:7700
```

When neither an explicit `connector` nor `node`/`auth` override tells it otherwise,
`elasticsearchLogSave` reuses that same DI-registered `'search'` connector instead of constructing a
second one — so setting `SEARCH_ENGINE`/`SEARCH_URL` once is enough for both the app's own
DI-injected connector and its logger to share one underlying client. If no core connector is
registered (or the app hasn't booted far enough to resolve it yet), it falls back to building a
fresh connector from whatever options `elasticsearchLogSave` was given, exactly as before.

There is currently no `meilisearchLogSave` bridge (`elasticsearchLogSave` stays
Elasticsearch/OpenSearch-specific); resolve `MeilisearchConnector` directly via
`this.connectors.get('search')`/`this.getProviderConnector('search')` in your own application code
when using Meilisearch.

### Selecting a search engine

`'search'` is a single core-connector slot, not independently-coexisting instances the way
`@zanix/auth`'s OAuth2 providers are. `SEARCH_ENGINE` is the single selector deciding which backend
registers for it — `'elasticsearch'`/`'opensearch'` (both select `ZanixElasticsearchConnector`) or
`'meilisearch'` (`MeilisearchConnector`); unset, no connector registers for `'search'` at all.

An unsupported value throws immediately at import time (directly, or via `@zanix/core`), rather than
silently registering nothing or falling back to a default:

```
InternalError: [search] "SEARCH_ENGINE" is set to "solr", which isn't a supported search engine —
use one of: elasticsearch, opensearch, meilisearch.
```

> **Breaking change**: prior versions gated each backend on its own env var
> (`ELASTICSEARCH_URL`/`OPENSEARCH_URL`/`MEILISEARCH_URL`), with a dedicated
> `assertSearchConfigNotConflicting()` guard rejecting the two being set at once. `SEARCH_ENGINE`
> (which backend) plus the generic `SEARCH_URL` (its connection URL) replace all three — the old
> vars are no longer read at all, so this is a direct rename with no dual-read/deprecation window.
> `ELASTICSEARCH_API_KEY`/`OPENSEARCH_API_KEY`/`MEILISEARCH_API_KEY` are unaffected.

## Testing against a real local cluster

The unit tests under `src/@tests/unit/observability/` mock `fetch` and never touch a real cluster.
`src/@tests/functional/observability/connector-real.test.ts` complements them by running against a
**real local OpenSearch** — this is what actually exercises the wire protocol end to end (NDJSON
body shape, a genuine `mapper_parsing_exception` partial-bulk failure, `_cluster/health`), which a
mock can't credibly reproduce.

Unlike the Mongo/Redis functional tests (which assume that infra is always running locally), this
one is **skipped by default** — a plain `deno test --allow-all` never requires Docker/OpenSearch to
be present. It's gated on the `RUN_OPENSEARCH_TESTS=true` environment variable, checked once at
module load and applied as `ignore: !shouldRun` on every `Deno.test` in the file.

1. Start a single-node OpenSearch with Docker (security plugin disabled — fine for local testing,
   not for anything internet-facing):

   ```sh
   docker run -d --name zanix-opensearch-test \
     -p 9200:9200 -p 9600:9600 \
     -e "discovery.type=single-node" \
     -e "DISABLE_SECURITY_PLUGIN=true" \
     -e "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
     opensearchproject/opensearch:2
   ```

2. Copy `.env.test.example` to `.env.test` at the project root (gitignored — it's for local use
   only) — it sets `RUN_OPENSEARCH_TESTS=true`, which the test file loads automatically via a tiny
   built-in `KEY=value` reader (no dotenv dependency).

3. Wait for the cluster to accept requests, then run the functional test:

   ```sh
   until curl -sf http://localhost:9200/_cluster/health >/dev/null; do sleep 2; done
   deno test --allow-all src/@tests/functional/observability/
   ```

CI sets `RUN_OPENSEARCH_TESTS=true` directly as a step-level env var (not via `.env.test`) and
starts an `opensearch` service container the same way it already does for `mongo`/`redis` — see
`.github/workflows/publish.yml`.

Stop and remove the container when done: `docker rm -f zanix-opensearch-test`.

`MeilisearchConnector` has the same two-layer coverage. The unit suite
(`src/@tests/unit/observability/meilisearch-connector.test.ts`) mocks `fetch`, including
task-polling behavior (`bulkIndex()`'s `GET /tasks/{taskUid}` loop).
`src/@tests/functional/observability/meilisearch-connector-real.test.ts` complements it against a
**real local Meilisearch instance** — real task-queue latency and terminal-status transitions a mock
can't credibly reproduce, plus one thing only a real instance could reveal: a Meilisearch write task
fails **atomically** (`details.indexedDocuments: 0` for the whole batch on any invalid document),
not per-document the way Elasticsearch's `_bulk` does — confirmed directly against a running
instance, not assumed from the ES connector's shape.

1. Start a local Meilisearch instance with Docker:

   ```sh
   docker run -d --name zanix-meilisearch-test \
     -p 7700:7700 \
     -e "MEILI_NO_ANALYTICS=true" \
     getmeili/meilisearch:v1.11
   ```

2. Copy `.env.test.example` to `.env.test` at the project root (gitignored) — it sets
   `RUN_MEILISEARCH_TESTS=true`, loaded the same way `RUN_OPENSEARCH_TESTS` is.

3. Wait for the instance to accept requests, then run the functional test:

   ```sh
   until curl -sf http://localhost:7700/health >/dev/null; do sleep 2; done
   deno test --allow-all src/@tests/functional/observability/
   ```

CI starts a `meilisearch` service container the same way as `opensearch` — its image's default
entrypoint needs no extra args, so (unlike SeaweedFS) a plain `services:` block is enough; see
`.github/workflows/publish.yml`.

Stop and remove the container when done: `docker rm -f zanix-meilisearch-test`.

## See also

- [Configuration](./configuration.md) — `SEARCH_ENGINE`, `SEARCH_URL`, `ELASTICSEARCH_API_KEY`,
  `OPENSEARCH_API_KEY`, `MEILISEARCH_API_KEY`.
- `@zanix/utils`'s [Logger guide](https://jsr.io/@zanix/utils/doc/logger) — the `storage.save`
  extension point this module plugs into, and the "reusable storage backend" factory-function
  pattern in general.
