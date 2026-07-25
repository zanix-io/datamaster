# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
