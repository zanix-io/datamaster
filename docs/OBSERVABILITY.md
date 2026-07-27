# Observability

Elasticsearch/OpenSearch persistence for [`@zanix/logger`](https://jsr.io/@zanix/utils/doc/logger).
Everything here lives under the `./observability` subpath — it's never re-exported from the package
root, so a consumer who doesn't import it pays zero cost and Logger stays fully independent of
DataMaster.

```ts
import { elasticsearchLogSave } from 'jsr:@zanix/datamaster@[version]/observability'
import { Logger } from 'jsr:@zanix/utils@[version]/logger'

const logger = new Logger({
  storage: {
    save: elasticsearchLogSave({ node: 'https://es.internal:9200', index: 'app-logs' }),
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
  node: Deno.env.get('ELASTICSEARCH_URL'), // falls back to ELASTICSEARCH_URL, then OPENSEARCH_URL, then http://localhost:9200
  index: 'app-logs', // or a per-document resolver: (doc) => `app-logs-${doc.level}`
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
`ELASTICSEARCH_URL`/`OPENSEARCH_URL` itself, no separate username/password env vars needed.

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
  index: 'app-logs',
  bulk: { maxSize: 100, flushIntervalMs: 5000 }, // defaults shown
  addTimestampField: true, // default; see "Timestamp handling" below
  useWorker: false, // default; see "Offloading the flush to a worker" below
  connector: undefined, // pass an existing ZanixElasticsearchConnector to reuse it instead
})

const logger = new Logger({ storage: { save } })

// In a graceful-shutdown hook, to send whatever's currently buffered ahead of schedule:
await save.flush()
```

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

`useWorker: true` dispatches each periodic `bulkIndex` call to a real `WorkerManager` worker thread
instead of running it inline on the main thread. This only ever applies to the batched flush, never
to an individual log call — applying it per-log would defeat buffering entirely (every dispatch
would spin up a worker with no shared state). The worker reconstructs a throwaway connector from
plain, structured-cloneable connection options (never a live connector instance, which can't cross
the `postMessage` boundary).

## Zero-config registration

Importing `jsr:@zanix/datamaster@[version]/core` auto-registers a default
`ZanixElasticsearchConnector` with the Zanix DI container, gated on either `ELASTICSEARCH_URL` or
`OPENSEARCH_URL` being set — mirroring how the Mongo/Redis/SQLite core connectors register
themselves. It registers under `@zanix/server`'s `'search'` core connector type, backed by the
`ZanixSearchConnector` abstract base `ZanixElasticsearchConnector` extends.

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

## See also

- [Configuration](./CONFIGURATION.md) — `ELASTICSEARCH_URL`, `OPENSEARCH_URL`.
- `@zanix/utils`'s [Logger guide](https://jsr.io/@zanix/utils/doc/logger) — the `storage.save`
  extension point this module plugs into, and the "reusable storage backend" factory-function
  pattern in general.
