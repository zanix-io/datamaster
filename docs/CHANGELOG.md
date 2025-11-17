# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
