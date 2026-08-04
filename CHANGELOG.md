# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-08-03

### Added

- `ScrollPaginationRTO`/`SearchPaginationRTO` (`@zanix/datamaster`'s `./database` entrypoint):
  ready-made, extensible `@zanix/validator` RTOs for `Model.paginateCursor`/`Model.paginate`'s own
  query-param shape (`cursor`/`limit`, and `page`/`limit`/`sortBy`). `sortBy` coerces every value to
  a number _before_ validating it's exactly `1`/`-1` — a raw HTTP query string always sends string
  values (e.g. `?sortBy[createdAt]=-1`), and passing those straight through to `Model.paginate`'s
  `sort` option throws a Mongoose `TypeError: Invalid sort value`, since Mongoose checks each value
  with strict equality against the numbers `1`/`-1`. Extend either class (redeclaring an `accessor`
  with its own decorator) to change a default or add fields — verified empirically that this doesn't
  affect the base class or lose inherited validation.
- New dependency: `@zanix/validator` (a `@zanix/utils` subpath already available transitively via
  this package's existing `@zanix/errors`/`@zanix/helpers`/`@zanix/logger`/`@zanix/types` imports —
  not a new package in the dependency graph).

## [1.2.0] - 2026-08-03

### Added

- `useDataPolicies` query option on `find`/`findOne`/`countDocuments` (and therefore `paginate`/
  `paginateCursor`, which use them internally): protects a filter's `mask`-strategy plaintext
  conditions (`$eq`/plain equality, or `$in` — including inside `$or`/`$and`/`$nor`) before the
  query runs, so a filter written against plaintext still matches masked-at-rest data — the
  read-side counterpart of the `updateOne`/`findOneAndUpdate` hook added in
  [1.1.0](#110---2026-08-03). Scoped to `mask`-strategy paths only (throws for `hash`/`encrypt`,
  which aren't deterministic); any other operator on a protected path also throws rather than
  silently returning wrong results. See
  [Data Protection: query-level protection](docs/DATA-PROTECTION.md#query-level-protection-usedatapolicies).
- `Model.buildSearchFilter(query, fields, conditions?)`: builds a partial-match `$or` search filter
  across `fields`, generalizing the common "search a few text fields, filter a couple of exact ones"
  repository pattern. Detects each field's data protection config automatically — an unprotected
  field gets a plain case-insensitive `$regex`; a `mask`-protected field has the search term masked
  first and matched as a **prefix** (`^...`, not an arbitrary substring — masking is a
  position-keyed transform, confirmed empirically); a `hash`/`encrypt`-protected field throws
  instead of silently matching nothing. See [Database: Search](docs/DATABASE.md#search-search).
- `paginate`/`paginateCursor` accept a `search: { query, fields }` option, sugar over
  `buildSearchFilter` — combined with `filter` via `$and` (never merged into one object) so an
  `$or`/`$and` already present in `filter` is never overwritten by the search's own `$or`.

### Fixed

- `docs/DATA-PROTECTION.md`'s masked-field partial-search example was missing the `^` anchor —
  masking is a position-keyed transform, so an unanchored `$regex` only reliably matches when the
  search term is a prefix of the plaintext, silently missing it when it occurs mid-string.

## [1.1.0] - 2026-08-03

### Added

- `useDataPolicies` query option on `updateOne` and `findOneAndUpdate` (and therefore
  `findByIdAndUpdate`, implemented as sugar over `findOneAndUpdate`): protects the update's
  `$set`/`$setOnInsert` payload in place before it executes, using each field's own configured
  protection settings — opt-in (`false`/unset by default), mirrors `upsertById`'s existing
  `useDataPolicies` flag, extended to a raw query call. See
  [Data Protection: query-level protection](docs/DATA-PROTECTION.md#query-level-protection-usedatapolicies).
- `bulkWrite` gets the same `useDataPolicies` option via a static override — Mongoose has no
  query-middleware hook for `bulkWrite` at all (a driver/ODM limitation, not specific to this
  library) — covering `updateOne`/`updateMany`'s `$set`/`$setOnInsert`, `insertOne`'s `document`,
  and `replaceOne`'s `replacement` within the batch.

### Changed

- **Breaking**: `AUTO_PROTECT_ON_DB_UPDATE` (and `extensions.autoProtectOnUpdate` when neither is
  set) is now **on by default** — previously opt-in (disabled unless explicitly enabled). Set the
  env var to the literal `'false'`, or `extensions.autoProtectOnUpdate: false` on a specific model,
  to opt back out. Still only ever covers document-level `.save()` on an already-hydrated,
  non-`isNew` document — never `updateOne`/`findOneAndUpdate`/`bulkWrite` (see the `useDataPolicies`
  addition above for those). See
  [Data Protection: automatic update-time protection](docs/DATA-PROTECTION.md#automatic-update-time-protection-autoprotectonupdate).

## [1.0.0] - 2026-08-02

### Added

- **Multiple Mongo connectors**: `registerModel` accepts an optional connector class as its second
  argument — `registerModel(model, SomeConnector, type?)` — binding a model (and its seeders) to a
  Mongo connector other than the default `'database'` slot. The target connector must already be
  `@Connector`-decorated by the time `registerModel` runs with it, or the call throws immediately,
  naming it. Models, seeders, and persisted triggers are now scoped per connector internally
  (previously one flat, unscoped registry) — see
  [Multiple Mongo connectors](docs/DATABASE.md#multiple-mongo-connectors). `getModel()` now throws a
  specific `'wrong-connector'` error (`error.meta.kind`) naming which connector(s) a model IS
  registered for, distinct from `'never-registered'` when it isn't registered anywhere.
- `extensions.autoProtectOnUpdate` (+ `AUTO_PROTECT_ON_DB_UPDATE` env var, explicit option always
  wins): opt-in automatic data protection on document-level `.save()` updates to an existing
  document, not just its first save. Detection compares a protected path's current value against a
  snapshot taken when the document was hydrated (a `post('init')` hook) — not a content/format
  heuristic — so it's safe even for one-way `hash` fields, which can't otherwise be checked without
  risking a silent, permanent re-hash.
- `checkProtectionRotationStatus()`: reports, per protected path, how many documents remain on an
  older protection version than the one currently active — the way to confirm it's actually safe to
  remove an old protection key from the environment after running `seedRotateProtectionKeys()`.
- `upsertManyById`'s underlying `bulkWrite` now retries only the specific operations MongoDB reports
  as failed (up to 3 times, with backoff) before giving up and re-throwing with the failed count
  logged — a transient failure for a handful of documents no longer requires re-running the whole
  operation.
- Triggers now consistently reverse data protection (decrypt/unmask protected fields, drop hashed
  ones) for every dispatched payload — the current document, `_old`, and a deleted document — across
  **all** document- and query-level paths (`save`, `updateOne`, `findOneAndUpdate`, `deleteOne`,
  `findOneAndDelete`). Previously only `updateOne`/`findOneAndUpdate`'s post-update dispatch did
  this; the rest saw raw encrypted/hashed values.
- New exports backing a local `/admin/triggers` API over the persisted triggers collection —
  `TriggersAdminRepository`, `TriggersAdminService`, and `createTriggersDiscoveryProvider()` (builds
  the Discovery provider for `/.well-known/zanix/triggers`) — plus `CreateTriggerInput`/
  `UpdateTriggerInput` types, derived from `TriggersModelAttrs`. `@zanix/admin` composes these into
  an actual HTTP surface; this package only owns the data access. See
  [Triggers: persisted triggers](docs/TRIGGERS.md#persisted-triggers-online-adaptation).
- `registerTriggerActionJob(actionKind, descriptor)`/`getRegisteredTriggerActionJobs()`: lets a
  package (`@zanix/notifications` for `mail`, `@zanix/core` for `request`) register the real job a
  built-in trigger action dispatches to, instead of every consumer being hardcoded to
  `DEFAULT_TRIGGER_JOBS`'s literal job names. `mail`/`request` still work with nothing registered —
  `DEFAULT_TRIGGER_JOBS` remains the fallback. See
  [Trigger actions](docs/TRIGGERS.md#trigger-actions-triggeractions).
- `_timeout` (milliseconds, default `20_000`) on `TriggerActionCommons`: sets the worker task's
  timeout when a trigger action dispatches locally (`runTask`, no `AMQP_URI` configured); has no
  effect on a queue-backed dispatch (`runJob`), which has no equivalent timeout parameter to forward
  it to.

### Changed

- **Breaking (call-signature)**: `registerModel`'s second positional parameter is now an optional
  connector class, pushing `type` to the third position (was: `registerModel(model, type?)`, now:
  `registerModel(model, connector?, type?)`). `DatabaseTypes` has been `'mongo'`-only since `0.6.0`
  and already defaults to it, so this only affects a caller that explicitly passed `'mongo'`
  positionally as the second argument — such a call must now pass `undefined` in that slot instead.

### Fixed

- A second core connector/provider booting (a second `ZanixMongoConnector`, or any other one of this
  package's built-in connectors/providers) no longer wipes the first's in-memory persisted-triggers
  registrations — every connector's persisted-triggers layer is now namespaced by its own
  `connectorKey` instead of sharing one flat, global registry. Confirmed with two real connectors on
  different `@Connector` slots and different physical databases; same slot or same database alone
  didn't surface the bug, since either one leaves both connectors reading/resetting what's
  effectively the same underlying state.
- A trigger action's `data` field (extra static payload merged into the dispatched job) is now
  actually interpolated — both `{{field}}` against the record and `${{ENV_VAR}}` against the
  environment — before being merged in. Previously it was split off _before_ either interpolation
  pass ran, so any placeholder written inside `data` was forwarded to the job unresolved, as literal
  text.
- `@Provider`/`@Connector` registration for every one of this package's built-in core
  connectors/providers (`ZanixMongoConnector`, `ZanixCacheCoreProvider`, `ZanixQLRUConnector`,
  `ZanixRedisConnector`, `ZanixKVStoreConnector`, `ZanixElasticsearchConnector`) now decorates the
  real class directly instead of wrapping it in a throwaway anonymous subclass — a DI lookup by the
  actual class every consumer imports (`this.providers.get(ZanixCacheCoreProvider)`,
  `this.connectors.get(ZanixMongoConnector)`, ...) now resolves correctly.
- `dataProtectionGetterDefinition`/`transformByDataProtection` no longer crash when reversing an
  unset `[String]` protected path (Mongoose defaults it to `[]`, which is truthy but has nothing to
  reverse) — this was surfacing through the triggers consistency fix above for any model with an
  array-typed protected field left unset.
- Corrected a `seedRotateProtectionKeys` doc claim: values already on the target protection version
  are **not** left untouched on a re-run — `mask` is deterministic (so it happens to look
  unchanged), but `encrypt` re-encrypts with a fresh IV every time, even without a key change.
- `ZanixMongoConnector#close()` no longer silently fails to stop triggers polling when the connector
  instance has been frozen by `TargetContainer` (every DI-managed deployment) — the poll timer/stop
  flag moved into a mutable nested object, since a direct property assignment on a frozen instance
  throws.

## [0.8.1] - 2026-07-28

## Added

- Added unit tests for `createDatabase` covering:
  - Database routing using the `db:model` syntax.
  - Default model registration without a database prefix.
- Added unit tests for persisted trigger helpers:
  - `isTriggersModelDisabled()`
  - `triggersModelName()`
  - Default and environment-based resolution behavior.
- Introduced the `DATABASE_SEEDERS_ENV` constant to centralize the `DATABASE_SEEDERS` environment
  variable.
- Added exported helpers for persisted triggers:
  - `DEFAULT_TRIGGERS_MODEL`
  - `isTriggersModelDisabled()`
  - `triggersModelName()`
- Exported Mongo connector environment variable constants:
  - `SEED_MODEL_ENV`
  - `TRIGGERS_MODEL_ENV`
  - `TRIGGERS_POLL_INTERVAL_ENV`
  - `TRIGGERS_CHANGE_STREAM_ENV`
- Exported Observability connector environment variable constants:
  - `ELASTICSEARCH_URL_ENV`
  - `OPENSEARCH_URL_ENV`

## Changed

- Replaced hardcoded `DATABASE_SEEDERS` references with the shared `DATABASE_SEEDERS_ENV` constant
  across model registration and seeder execution.
- Centralized the default persisted triggers collection name through `DEFAULT_TRIGGERS_MODEL`.
- Updated the Mongo connector to reuse the shared default triggers model constant.
- Updated the Observability connector to use exported environment variable constants instead of
  string literals.
- Re-exported the new constants and helper utilities through the public module API.

## Improved

- Reduced duplicated environment variable literals across the Database and Observability modules.
- Improved API discoverability by exposing reusable environment variable constants and helper
  functions.
- Increased test coverage for environment-driven configuration and multi-database model
  registration.

## [0.8.0] - 2026-07-27

### Added

- **New `./observability` subpath**: Elasticsearch/OpenSearch persistence for `@zanix/logger` — see
  [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md). Never re-exported from the package root, so a
  consumer who doesn't import it pays zero cost and `@zanix/logger` stays fully independent of
  DataMaster.
  - **`ZanixElasticsearchConnector`**: a plain `fetch`-based connector for Elasticsearch OSS,
    Elasticsearch (Free tier), and OpenSearch — no vendor SDK, to sidestep both
    `@elastic/elasticsearch`'s product-check friction against non-Elastic servers and
    `@opensearch-project/opensearch`'s lack of official support against real Elasticsearch. Extends
    `@zanix/server`'s new `ZanixSearchConnector` abstract base (see below), registering under the
    `'search'` core connector type.
    - `index(doc, opts?)` / `bulkIndex(docs, opts?)` — write one or many plain
      `Record<string, unknown>` documents via `POST /{index}/_doc` / `POST /_bulk` (NDJSON).
      `bulkIndex` inspects `items[].error` for per-document partial failures rather than relying on
      the request not having thrown (a bulk request responds `200` even when individual documents
      fail).
    - `search(query, opts?)` — runs a raw Query DSL body via `POST /{index}/_search`, or
      cluster-wide `POST /_search` if no index can be resolved. Deliberately untyped on `query`'s
      shape — the DSL itself is the reason to reach for `search()` over `index`/`bulkIndex`.
    - `refresh(opts?)` — forces an index refresh (`POST /{index}/_refresh`) so just-written
      documents become immediately searchable, instead of waiting for the next automatic refresh
      cycle. Mainly for tests/read-your-own-write scenarios — calling it on every write in a
      production hot path hurts indexing throughput.
    - `checkClusterHealth()` — an explicit, asynchronous cluster reachability check via
      `GET /_cluster/health`, separate from the inherited, always-`true`, synchronous `isHealthy()`.
    - `node`/`auth` resolve with the same explicit-option-over-env-var precedence
      `MONGO_URI`/`REDIS_URI` already follow: `node` falls back to `ELASTICSEARCH_URL`, then
      `OPENSEARCH_URL`; `auth`'s API-key shape falls back to `ELASTICSEARCH_API_KEY`, then
      `OPENSEARCH_API_KEY`. Basic auth has no env var counterpart — it can be embedded directly in
      the URL instead (`https://user:pass@host:9200`), verified directly against this connector:
      `fetch` honors userinfo in a URL and sends it as a real `Authorization: Basic` header.
  - **`elasticsearchLogSave(options?)`**: a `@zanix/logger` `storage.save` **factory function** —
    call it with plain configuration and it returns a `SaveDataFunction`, indistinguishable from a
    handwritten `storage: { save: (context) => {...} }` from Logger's perspective. Buffers formatted
    logs in memory (`BulkBuffer`, internal) and flushes them via `bulkIndex` on a size-or-time
    threshold (`bulk: { maxSize, flushIntervalMs }`), instead of one HTTP round trip per log call.
    Aliases the formatted log's own `timestamp` field to `@timestamp` (the field Kibana/OpenSearch
    Dashboards look for by default) without ever overwriting an already-present `@timestamp` or
    removing the original field; only synthesizes a fresh timestamp when no time-like field is
    present at all (`addTimestampField`, default `true`). `useWorker: true` offloads the periodic
    flush (never an individual log call) to a real `WorkerManager` worker thread. A flush failure is
    reported via `logger.error(..., 'noSave')`, never thrown back to the caller. The returned
    function has a `flush()` escape hatch for graceful-shutdown hooks to send whatever's currently
    buffered ahead of schedule.
  - Auto-registers a default `ZanixElasticsearchConnector` with the Zanix DI container when
    importing `./core`, gated on either `ELASTICSEARCH_URL` or `OPENSEARCH_URL` being set —
    mirroring the Mongo/Redis/SQLite core connectors.
- Bumped the `@zanix/server` dependency to `2.0.4`, which adds `ZanixSearchConnector` (the new
  `'search'` core connector type's abstract base, extending `RestClient`) and the `BulkIndexResult`
  type — both consumed by `ZanixElasticsearchConnector` above.
- Real-cluster functional tests for the observability module
  (`src/@tests/functional/observability/connector-real.test.ts`), opt-in via
  `RUN_OPENSEARCH_TESTS=true` (see `.env.test.example`) so a plain `deno test --allow-all` never
  requires Docker/OpenSearch to be running. CI sets the env var directly and starts an `opensearch`
  service container, same as it already does for `mongo`/`redis`.

### Fixed

- Several docs examples (`README.md`, `docs/DATABASE.md`, `docs/CACHE.md`) used Node's
  `process.env.X` to read an environment variable — this is a Deno library; corrected to
  `Deno.env.get('X')`.

## [0.7.0] - 2026-07-26

### Added

- Persisted triggers now stay current without a restart, via three complementary mechanisms — see
  [docs/TRIGGERS.md](docs/TRIGGERS.md#keeping-the-registry-fresh-without-a-restart):
  - **On-write refresh** (always on, no configuration): the persisted triggers model's own schema
    gets `post('save')`/`post(['updateOne', 'findOneAndUpdate'])`/
    `post(['deleteOne', 'findOneAndDelete'])` hooks that refresh the in-memory registry instantly
    for any write made through this connector's own model.
  - **Polling** (`triggersPollInterval`, milliseconds; `false`/omitted by default) — a safety net
    that re-reads the collection on a timer, catching writes on-write refresh can't see (a separate
    service, another replica, a direct database edit).
  - **Change Stream** (`triggersChangeStream: true`; `false` by default) — watches the collection
    via MongoDB's Change Streams API for near-instant, cross-replica sync. Requires a replica
    set/sharded cluster; gracefully logs and falls back to the other two mechanisms otherwise,
    instead of failing connector startup.
- Four new environment variable counterparts for `ZanixMongoConnector`'s constructor options —
  `SEED_MODEL_NAME`, `TRIGGERS_MODEL_NAME`, `TRIGGERS_POLL_INTERVAL`, `TRIGGERS_CHANGE_STREAM` — see
  [Configuration](docs/CONFIGURATION.md#connection-variables). Same precedence rule as `MONGO_URI`:
  an explicit constructor option always wins over its env var, which only applies when the option is
  omitted entirely. The literal string `'false'` disables the two model-name variables, the same
  convention `DATABASE_SEEDERS` already uses.
- Expanded test coverage for the new live-sync mechanisms (the concurrent-close race in the poll
  loop, document- vs query-level refresh hooks, Change Stream degradation against a standalone Mongo
  instance) and closed pre-existing coverage gaps found in the same pass: `RedisPipelineScheduler`
  (flush guards, error handling, `shutdown`) and `ZanixCacheCoreProvider` (cache-read/write error
  paths, background-refresh failures, `withLock`).

### Fixed

- A race in the persisted-triggers poll loop: a tick already in flight when the connector's
  `close()` ran could still schedule one more timer via its `.finally()` callback _after_
  `close()`'s own `clearTimeout` had already fired, leaking a poll against an already-closed
  connection. Guarded with a `triggersPollStopped` flag checked right before each reschedule.

## [0.6.0] - 2026-07-26

### Added

- `getModel` has a new, additive overload:
  `getModel(name, { definition, options, extensions,
  callback })` — the same plain
  `{definition, options, extensions, callback}` shape `registerModel` itself accepts, with field
  markers (`String`, `Boolean`, `Date`, ...) that are plain JS globals, not `mongoose` symbols. The
  connector builds the real `Schema` internally, the same way `defineModels()` already does for
  `registerModel` — so a caller that only needs one ad-hoc model no longer has to import `mongoose`
  themselves just to construct a `Schema` by hand. Both existing `getModel` overloads
  (schema-instance, name-only lookup) are unchanged.
- Functional test confirming a model created via the new plain-definition overload dispatches its
  `extensions.triggers` for real (including editing the persisted trigger directly in MongoDB and
  confirming the edited job fires instead of the original one on the next boot) — the same behavior
  already proven for the schema-instance/`registerModel` paths, now covered for this one too.
- Small `getModel` documentation addition in `docs/DATABASE.md` for the new overload.

### Changed

- **Breaking (type-level only)**: `DatabaseTypes` narrowed from `'mongo' | 'postgress'` to just
  `'mongo'`. The removed member was never functional — its only real usage
  (`seedProcessor.postgress` in `utils/seeders/adaptation.ts`) was a hardcoded
  `throw new
  Error('Not implemented')` — so this doesn't change behavior for anyone, only removes
  a misleading type-level option. See the type's own doc comment for why a real second backend isn't
  a small follow-up (schema/DDL construction and trigger dispatch would each need a full,
  independent implementation, not a thin adapter over the existing Mongo code).
- `seederAdaptation` now throws a clear, generic "no seed processor for database type" error for any
  unsupported `type`, instead of relying on one hardcoded fake getter that only covered the
  now-removed `'postgress'` case.

## [0.5.2] - 2026-07-25

### Fixed

- `deno_doc`/JSR's symbol-documentation check doesn't follow named re-export reference chains
  (`export { X } from './y.ts'`) back to the original declaration's JSDoc — each re-exported name
  needed its own inline doc comment placed inside the export's braces, or it was counted
  undocumented even though the real declaration was fully documented. Added inline JSDoc to every
  named re-export in `database/mod.ts` and `cache/mod.ts`, bringing symbol-documentation coverage to
  100%.

## [0.5.1] - 2026-07-25

### Changed

- Completed JSDoc coverage across the model/trigger/protection typings, and removed
  `RedisClientType` from `cache/mod.ts`'s public exports so JSR's symbol-documentation score no
  longer counts Redis's own undocumented internal type graph against this package.

## [0.5.0] - 2026-07-24

### Added

- **Triggers system**: reactive `mail`/`request`/`custom` actions tied to a Mongoose model's
  create/update/delete lifecycle, declared via `extensions.triggers` in `registerModel`. Actions
  support condition evaluation (`=`, `!=`, `<`, `>`, `<=`, `>=`, `includes`, plus `and`/`or`/`not`
  composition), `{{field}}`/`{{nested.path}}` interpolation against the record the trigger fired
  for, and dispatch via `@zanix/server`'s worker provider — `runJob` (queue-backed) when `AMQP_URI`
  is configured, `runTask` (local) otherwise. `mail`/`request` dispatch to well-known job names
  (`DEFAULT_TRIGGER_JOBS.mail`/`.request`) that a consuming app (e.g. `@zanix/core`) is expected to
  register handlers for; `custom` dispatches to a caller-registered job by name. `request` actions
  with a bodyless HTTP method (`GET`/`HEAD`/`DELETE`) have `body` converted to query parameters
  instead of being dropped. See `docs/TRIGGERS.md`.
- **Persisted (runtime) triggers**: a new `triggersModel` connector option (default
  `'zanix-triggers'`, `false` to disable) backs an internal collection for adding/toggling triggers
  at runtime without redeploying code. A model's own static `extensions.triggers` is auto-seeded
  into this collection as a "default" entry on first boot with a triggers model enabled; from then
  on the persisted entry — not the code — governs that model, so it can be edited or disabled from
  the database without ever double-firing alongside its own code definition. Default entries stay in
  sync with later code changes automatically, but a manual edit always wins over a subsequent code
  change. Non-default entries (created independently, e.g. via an admin endpoint) simply combine
  with a model's static triggers. New `TriggersModelAttrs` type and `registerTriggersModel` DSL
  helper.
- New exports: `DEFAULT_TRIGGER_JOBS` (well-known job names for `mail`/`request` dispatch) and the
  `TriggersModelAttrs` type, from both the root and `./database` entrypoints.
- Full test coverage for the triggers feature: condition evaluation, dispatch (interpolation,
  bodyless-method query conversion, job routing), the static/persisted trigger registry, the
  default-entry sync planner, and end-to-end Mongoose hook behavior (functional + unit tests).

### Changed

- **Breaking**: `Semaphore` and `LockManager` are no longer exported from this package's public
  entrypoints (`mod.ts`). They've moved to `@zanix/utils`'s helpers module — import them from
  `@zanix/helpers` (or `jsr:@zanix/utils/helpers`) instead of `@zanix/datamaster`.
  `docs/CONCURRENCY.md` (which documented them) has been removed; `README.md`, `docs/CACHE.md`, and
  `docs/DATABASE.md` were updated to drop references to it and describe `withLock` in terms of an
  internal lock manager instead.
- `@zanix/server` dependency bumped to `2.*` (from `1.*`) to align with `@zanix/server@2.0.0`.
- `mail` trigger action's shape changed from `{ template: string }` (plus common fields) to a
  structured `{ to, subject, body: { template, data? }, from?, date? }` — every string field
  supports `{{field}}` interpolation.
- `request` trigger action's `body` is now optional.
- `MongoModelDefinition.extensions.seeders` is now optional (`seeders?:` instead of a required
  array), matching that seeders are opt-in.
- Internal `LockManager` usages (`sqlite/connector.ts`, `cache/providers/mod.ts`) now import from
  `@zanix/helpers` instead of the removed internal module.
- `docs/DATABASE.md`, `docs/DATA-PROTECTION.md`, and `README.md` updated with `Triggers`
  documentation, cross-links, and a `@zanix/core` mention as the recommended full-app entrypoint
  that auto-registers the `mail`/`request` trigger job handlers.

### Fixed

- Removed a broken, dangling `mod.ts` export
  (`export { LockManager } from
  'utils/queues/lock-manager.ts'` and the equivalent `Semaphore`
  line) that pointed at now-deleted internal files.

### Removed

- `Semaphore` and `LockManager` internal implementations (`src/utils/queues/semaphore.ts`,
  `src/utils/queues/lock-manager.ts`) — superseded by `@zanix/utils`'s helpers (see Changed).
- `docs/CONCURRENCY.md` — superseded by the `@zanix/helpers`-based documentation now inline in
  `docs/CACHE.md`/`docs/DATABASE.md`.

## [0.4.16] - 2026-07-23

### Added

- Exposed previously-internal types required to satisfy JSR's public type-graph resolution,
  including `Model`, `SchemaStatics`, `BaseCustomSchema`, `Extensions`, `Triggers` and its
  condition/action types, the full `DataProtection*`/`DataAccessConfig*` family,
  `ModelDef`/`ModelMetadata`/`BaseModel` and related model-definition types, `ReadDocumentsOptions`,
  `ExpiredValueEntry`, `RedisOptions`, `RedisPipelineScheduler`, and `Program`. All are re-exported
  from the package's entrypoints (`.`, `./database`, `./cache`) so `deno doc --lint` reports zero
  errors outside third-party (`redis`) type references.

### Fixed

- `getAllSubschemas` silently dropped subschemas nested inside an array of arrays of subdocuments
  (e.g. `{ matrix: [[itemSchema]] }`) — it checked a non-existent `schemaType` property instead of
  the real `caster` property Mongoose exposes on nested `SchemaArray`s.
- Resolved two `deno publish` slow-types failures: an internal (non-public) overload of
  `ZanixMongoConnector.getModel` referenced an unreachable type in its generic default, and
  `RedisPipelineScheduler`'s constructor destructured an indexed-access type that included
  `undefined` despite always receiving a default value.
- Broken README anchor links: the table of contents linked to emoji-prefixed fragments (e.g.
  `#🧩-description`) that don't match the anchors real Markdown renderers generate from
  emoji-prefixed headings.
- README's license link pointed to `docs/LICENSE`, which had moved to the project root in `0.4.13`.
- README's "import specific modules" example used internal `export ... from` re-export syntax and
  internal file paths instead of the real `import` statements a consumer would write.
- README's DSL example was missing the `dataPoliciesGetter` import it uses, referenced a
  non-existent `connector.connectorReady` property (the real property is `isReady`), and called
  `connector['initialize']()` manually even though `autoInitialize` defaults to `true`.
- The JSDoc for `encrypt`/`decrypt` (`utils/protection.ts`, and the matching `SchemaStatics`
  overloads in `mongo/typings/statics.ts`) referred to a non-existent `DATA_RSA_PRIVATE_KEY`
  environment variable — the real variable, and the one already used correctly elsewhere in the same
  files, is `DATA_RSA_KEY`.

### Changed

- Moved `CHANGELOG.md` to the project root (previously under `docs/`), matching `LICENSE`.
- Split the README's flat "import everything" example and its environment-variable/versioned-keys
  tables out into dedicated guides — `docs/DATABASE.md`, `docs/DATA-PROTECTION.md`,
  `docs/TRANSFORMS.md`, `docs/CACHE.md`, `docs/CONCURRENCY.md`, `docs/CONFIGURATION.md` — and
  replaced them in the README with a compact "key exports → guide" table and a "Documentation"
  section linking all six, following the same structure used in `@zanix/server`'s docs.
- Switched every README/guide example from the `./database`/`./cache` subpath imports to the root
  `@zanix/datamaster` import, matching how the library is imported in every real consumer checked —
  the subpaths are now presented as an optional, secondary way to scope imports rather than the
  default.
- Documented real patterns found only by reading a production consumer, not covered before: calling
  a bound model's protection statics directly (`Model.hash`/`Model.encrypt`/`Model.mask`/
  `Model.unmask`/`Model.validateHash`) to protect a value before a write that bypasses `save()`;
  masking a search term to query a field stored masked; `versionConfigs: { default: {...} }` alone
  (no explicit per-version keys) as the common case; and `toJSON`'s `userSession` override for
  serializing outside of any ALS context.

## [0.4.15] - 2026-07-22

### Fixed

- `SchemaMethods` type was not re-exported from `./database`, leaving consumers unable to name
  `AdaptedModel`'s document method types.

## [0.4.14] - 2026-07-22

### Fixed

- Made `SchemaMethods.toJSON`'s `userSession.type` option optional (it was incorrectly required).

## [0.4.13] - 2026-07-22

### Fixed

- `SchemaMethods` is now generic over the model's attributes (was hardcoded to
  `Record<string, any>`), so `toJSON()` on a schema-derived model returns the actual document shape
  instead of a generic object.
- Moved the `LICENSE` file to the project root (previously under `docs/`).

### Changed

- Compatibility fixes for Deno 2.9.

## [0.4.12] - 2026-07-22

### Fixed

- `transformByDataAccess` could recurse infinitely: Mongoose 8+ snapshots the options object passed
  to `toJSON`/`toObject` and reuses that snapshot on nested calls, which kept re-invoking this
  transform. Internal (`_`-prefixed) bookkeeping keys are now stripped before spreading the options.
- `VerifiableObject`, `DecryptableObject`, and `UnmaskableObject` now allow `null`, matching what
  data-protection getters can actually return for empty/absent fields.

### Changed

- Internal compatibility fixes for Deno 2.9 (e.g. replaced TC39 `accessor` class fields on
  `ZanixRedisConnector` with plain private fields and explicit getters/setters).

## [0.4.11] - 2025-12-21

### Removed

- Removed the unimplemented `runOnWorker` seeder option — it was never wired to a real worker/task
  runner and always ran inline.

### Changed

- `ZanixMongoConnector` now logs its configured `name` instead of `this.constructor.name`, so log
  messages reflect the connector's actual display name.

### Added

- Logs a message when the MongoDB connection starts closing.

## [0.4.10] - 2025-12-02

### Fixed

- `paginate`/`paginateCursor` now also work on models created via `getModel(schema)`
  (`AdaptedModelBySchema`), not only on DSL-registered models.
- Loosened `ReadDocumentsOptions.filter`/`onDocument` typing to accept documents with extra fields.

## [0.4.9] - 2025-12-02

### Added

- Added a pagination cursor for scrolling through documents.
- Implemented pagination support for search results.

## [0.4.8] - 2025-11-30

### Fixed

- Exclude hashed values during seed key rotation.
- Include default `versionConfig` in versioning data policies.

## [0.4.4] - 2025-11-21

### Added

- **Multi-database support for model names**, allowing the `database:model` syntax to register and
  reference models across different databases.
- **Multi-database support in model definitions (`defs`)**, enabling relations (`ref`) that point to
  models in other databases using the same `database:model` format.
- **New environment variable: `DATABASE_SEEDERS`**
  - Controls whether system seeders are executed.
  - Defaults to `true`.
  - Set to `false` to globally disable all seed operations.

## [0.4.3] - 2025-11-19

### Fixed

- Fixed an issue where the Mongo connector was not making the model available until the connection
  was established.

  Now, the model is made available immediately, allowing services to access it without waiting for
  the connection to be fully established.

  This improves behavior in scenarios where services try to access the model before the connection
  is available.

## [0.4.2] - 2025-11-19

### Fixed

- Removed top-level `await` from core modules to avoid resource leaks during test runs.

## [0.4.1] - 2025-11-19

### Changed

- Replaced Higher-Order Component (HOC) files with `defs` files to unify module definitions and
  centralize DSL-based declarations, metadata, and foundational structures. This improves
  consistency and simplifies the architecture for components like handlers, interactors, providers,
  and connectors.

## [0.4.0] - 2025-11-17

### Added

- Support for **SQLite** as a local key-value store backend.
- **ZanixKV connector** for lightweight and fast KV storage with optional TTL and per-key locking.

## [0.3.5] - 2025-11-17

### Fixed

- Core cache provider local instance autoinitialization

## [0.3.4] - 2025-11-17

### Changed

- Random TTL Offset

## [0.3.3] - 2025-11-15

## [0.3.2] - 2025-11-15

### Added

- `Semaphore` implementation for managing concurrent access.
- `LockManager` for keyed concurrency control using semaphores.
- `withLock` function added to the Cache provider for safe serialized operations.

## [0.3.1] - 2025-11-14

### Added

- **Scheduler providers**: Added support for scheduler providers in cache systems.

### Changed

- **Cache provider**: Enhanced cache provider to support scheduling and client retrieval
  functionality.

## [0.3.0] - 2025-11-12

### Changed

- Data protection types

### 🆕 Added

- Redis connector.
- Local Cache.
- Cache providers.

## [0.2.0] - 2025-11-08

### 🆕 Added

- **Versioned data protection support:** Added support for versioned data protection strategies
  (`mask`, `encrypt`). Environment variables can now be versioned (e.g. `DATA_AES_KEY_V1`,
  `DATA_RSA_PUB_V2`, etc.), allowing controlled key rotation and migration via
  `seedRotateProtectionKeys`. If no version is defined, the default (**v0**) non-suffixed variables
  are used. Supported configurations:

  - **Masking/unmasking:** `DATA_SECRET_KEY` (fallback: `DATA_AES_KEY`)
  - **Symmetric encryption:** `DATA_AES_KEY`
  - **Asymmetric encryption:** `DATA_RSA_PUB`, `DATA_RSA_KEY` (base64)

- **Mongo seed registration:** Added database seeder to register processes in MongoDB (see
  `seedModel` option in `ZanixMongoConnector`).

### Fixed

- Data policies options supported.
- Data policies accessors fix.

## [0.1.6] - 2025-11-04

### Fixed

- Seeder virtualId conflicts

### Added

- Some types and mongoose objects exported

## [0.1.5] - 2025-11-04

### Added

- Mongo testing support on CI
- Mongo base seeders
- Some mongo model statics

## [0.1.4] - 2025-11-04

### Added

- ZanixMongoConnector core module definition

## [0.1.3] - 2025-11-04

### Added

- ZanixMongoConnector JSDOC

## [0.1.2] - 2025-11-04

### Added

- Main modules JSDOC

## [0.1.1] - 2025-11-04

### Added

- Some modules JSDOC

## [0.1.0] - 2025-11-03
