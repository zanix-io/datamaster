# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
