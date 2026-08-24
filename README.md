# Zanix – Datamaster

[![Version](https://img.shields.io/jsr/v/@zanix/datamaster?color=blue&label=jsr)](https://jsr.io/@zanix/datamaster/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/datamaster?color=blue&label=git)](https://github.com/zanix-io/datamaster/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

1. [Description](#-description)
2. [Features](#-features)
3. [Installation](#-installation)
4. [Basic Usage](#-basic-usage)
5. [Documentation](#-documentation)
6. [Contributing](#-contributing)
7. [Changelog](#-changelog)
8. [License](#-license)
9. [Resources](#-resources)

---

## 🧩 Description

**Zanix Datamaster** is a core component of the **Zanix** ecosystem — a toolkit designed for modern
micro-applications. It offers a **unified API for database and cache connectors**, supporting
services such as **MongoDB**, **Redis**, **Memcached**, and **SQLite** (as a KV store).

Out of the box, it provides full support for **MongoDB**, **Redis**, **Memcached**, and **KV
stores**, including schema management utilities, advanced data transformations, robust access and
protection policies, local caching utilities, such as in-memory Map for fast, etc.

> 💡 Special thanks to the external database and cache providers whose technologies make this module
> possible.

> 💡 If you're building a full application, the recommended entrypoint is
> **[`@zanix/core`](https://jsr.io/@zanix/core)**, which wires this package together with
> `@zanix/asyncmq`, `@zanix/auth`, and `@zanix/notifications` via
> `Zanix.start()`/`Zanix.startWorker()` — including automatic registration of the `mail`/`request`
> trigger job handlers (see [triggers.md](docs/triggers.md)).

---

## ✨ Features

- **MongoDB connector**

  - Native `ZanixMongoConnector` class.
  - Deep schema utilities & accessor helpers.
  - Recursive and shallow data transformations.
  - Built-in data access and protection policies.
  - `AsyncLocalStorage` (ALS) support.
  - Supports **multiple databases** via model names <br>(e.g., `modelName: 'database:model'`), also
    valid in population refs. <br>⚠️ **This approach is not recommended for microservices**, since
    each microservice should have **its own independent database** to maintain decoupling, autonomy,
    and scalability.
  - Supports **multiple Mongo connectors** in the same app — `registerModel`'s optional third
    argument targets a specific `@Connector`-decorated connector class, isolated from the default
    one (models, seeders, and persisted triggers all scoped per connector).

- **Redis connector**

  - Native `ZanixRedisConnector` class.
  - Optimized connection pooling and async operations.
  - Supports pub/sub, key expiration, and data serialization.
  - Designed for caching, queueing, and distributed locking.

- **Memcached connector**

  - Native `ZanixMemcachedConnector` class — the classic Memcached text protocol over a raw TCP
    socket, no external client dependency.
  - Key expiration (TTL), with automatic relative/absolute `exptime` handling.
  - ⚠️ `keys()`/`values()`/`size()` are backed by a per-instance key index, not a server-side
    listing (the protocol has none) — see
    [Cache](./docs/cache.md#keysvaluessize-a-real-protocol-limitation-not-a-bug).

- **Local cache system**

  - Based on `Least Recently Used (LRU)` for ultra-fast in-memory caching..
  - Automatic eviction policy (LRU).
  - Serves as a fallback when the external cache is unavailable.

* **Key-value store connector**

  - Lightweight and fast **SQLite-backed key-value store**.
  - Supports **optional TTL (Time-To-Live)** for automatic expiration.
  - Provides **get, set, delete, and clear** operations.
  - Includes **per-key exclusive locking** for safe concurrent access.
  - Ideal for local storage, caching, and lightweight persistence scenarios.

- **Cache provider & strategies**

  - `getCachedOrFetch`: Retrieves a value from cache with local fallback and optional fetch.
  - `getCachedOrRevalidate`: Retrieves a cached value using a soft TTL strategy and local fallback.
  - Unified API for managing multi-layer caching (Redis + local).
  - Customizable cache adapters and TTL policies.
  - `withLock`: Ensures serialized, concurrency-safe operations for a given cache key **in
    non-distributed systems**.
    - Prevents race conditions in write-heavy scenarios.
    - Guarantees only one mutation for the same key runs at a time.

- **Model DSL definition support (Database Only)**

  - Define and load models dynamically with `registerModel`.
  - Supports **seeders**: either **(a)** an array of async/sync functions
    `handler: (Model, connector) => void | Promise<void>` **or (b)** an array of objects:
    `{ handler, options: { version: '0.1.0', verbose: false } }` to populate initial data.
  - Allows callbacks to extend schemas with custom methods.
  - Simplifies querying and CRUD operations with the connector instance.

- **Observability**

  - Native `ZanixElasticsearchConnector` class for Elasticsearch OSS, Elasticsearch (Free tier), and
    OpenSearch — a plain `fetch`-based client, no vendor SDK.
  - Native `MeilisearchConnector` class for [Meilisearch](https://www.meilisearch.com) — same
    plain-`fetch`, no-vendor-SDK approach, applied to Meilisearch's own real REST API. Backs the
    _same_ `'search'` core connector slot as `ZanixElasticsearchConnector` — `SEARCH_ENGINE`
    (`elasticsearch`/`opensearch`/`meilisearch`) selects which one, and `SEARCH_URL` its connection
    URL, so only one search engine is ever configured per deployment.
  - `elasticsearchLogSave`: a `@zanix/logger` `storage.save` factory that persists formatted logs
    via buffered `_bulk` requests, with `@timestamp` aliasing and optional worker-thread offload for
    the periodic flush.
  - Only available via the dedicated `./observability` subpath (see below) — importing it is always
    an explicit, opt-in choice, keeping `@zanix/logger` fully independent of DataMaster.

- **Storage**

  - Native `S3ObjectStorage` class — a generic byte store (put/get/delete/exists over an opaque key)
    backed by a real `@aws-sdk/client-s3` client against any S3-compatible gateway (e.g. SeaweedFS,
    MinIO, AWS S3 itself). Registers the `'s3'` core connector slot, the same DI mechanism
    `'database'`/`'search'` use.
  - `MongoFileRepository`: a generic, durable file record registry, following the same
    `@Provider`/`ZanixMongoConnector` shape as `TriggersAdminRepository`/`DlqProvider`. Neither
    component assumes a specific file kind, processing state, or consuming domain.
  - Optional, opt-in object content encryption at rest (AES-GCM, or RSA-wrapped per-object AES keys)
    — reuses this package's own existing `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY`
    data-protection keys, no separate key management to set up.

- **Extensible architecture**

  - Ready for future connectors (PostgreSQL).
  - Everything is available from the root package (except `./observability`, see above); several
    narrower entrypoints exist for consumers who prefer to scope their imports:

    - `./cache` → cache systems only.
    - `./database` → database connectors only.
    - `./observability` →
      `ZanixElasticsearchConnector`/`MeilisearchConnector`/`elasticsearchLogSave` only.
    - `./triggers-api` → `createTriggersAdminController`, the local `/admin/triggers` HTTP surface,
      only.
    - `./dlq-api` → `createDlqAdminController`, the local `/admin/dlq` HTTP surface, only.
    - `./storage` → `S3ObjectStorage` only.
    - `./files` → `MongoFileRepository`/`registerFileModel` only.
    - `./core` → side-effect-only import that auto-registers the default Mongo, Redis, Memcached,
      local-cache, SQLite, and Elasticsearch/OpenSearch/Meilisearch connectors/providers with the
      Zanix DI container, for apps that don't need to customize their configuration.

- **Seamless Zanix integration**

  - Works perfectly with [`@zanix/server`](https://jsr.io/@zanix/server).

---

## 📦 Installation

Install via **JSR** using [Deno](https://deno.com/):

```ts
import * as datamaster from 'jsr:@zanix/datamaster@[version]'
```

Rather than the wildcard import above, you'll typically import only what you need. The table below
groups the main exports by category — each links to a guide with full usage examples:

| Category                      | Key exports                                                                                                                                                                                                         | Guide                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mongo connector & models      | `ZanixMongoConnector`, `registerModel`, `Schema`                                                                                                                                                                    | [Database](./docs/database.md)                                          |
| Seeders                       | `seedByIdIfMissing`, `seedManyByIdIfMissing`, `seedRotateProtectionKeys`                                                                                                                                            | [Database](./docs/database.md#seeders-registermodels-extensionsseeders) |
| Triggers                      | `extensions.triggers`, `DEFAULT_TRIGGER_JOBS`, `registerTriggerActionJob`, `TriggersAdminRepository`, `TriggersAdminService`, `createTriggersDiscoveryProvider`, `createTriggersAdminController` (`./triggers-api`) | [Triggers](./docs/triggers.md)                                          |
| SQLite (KV store)             | `ZanixKVStoreConnector`, `LocalSQLite`                                                                                                                                                                              | [Database](./docs/database.md#sqlite-key-value-store)                   |
| Transforms & schema utilities | `transformRecursively`, `transformDeepByPaths`, `transformShallowByPaths`, `transformByDataAccess`, `transformByDataProtection`, `getAllSubschemas`, `findPathsWithAccessorsDeep`                                   | [Transforms](./docs/transforms.md)                                      |
| Data protection               | `dataProtectionGetter`, `dataAccessGetter`, `dataPoliciesGetter`, `datamasterEncrypt`/`Decrypt`/`Mask`/`Unmask`/`Hash`, `createDecryptableObject`, `createUnmaskableObject`, `createVerifiableObject`               | [Data Protection](./docs/data-protection.md)                            |
| Cache                         | `ZanixCacheCoreProvider`, `ZanixRedisConnector`, `ZanixMemcachedConnector`, `ZanixQLRUConnector`, `scanKeys`                                                                                                        | [Cache](./docs/cache.md)                                                |
| Observability                 | `ZanixElasticsearchConnector`, `MeilisearchConnector`, `elasticsearchLogSave`                                                                                                                                       | [Observability](./docs/observability.md)                                |
| Dead Letter Queue             | `DlqProvider`, `registerDlqModel`, `DlqAdminService`, `createDlqAdminController` (`./dlq-api`), `createDlqDiscoveryProvider` (distributed processing lives in `@zanix/asyncmq/dlq`)                                 | [DLQ](./docs/dlq.md)                                                    |
| Storage                       | `S3ObjectStorage` (`./storage`), `MongoFileRepository`, `registerFileModel` (`./files`)                                                                                                                             | [Storage](./docs/storage.md)                                            |
| Configuration                 | Environment variables for connections and data protection                                                                                                                                                           | [Configuration](./docs/configuration.md)                                |

```ts
import { registerModel, ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]'
```

> Replace `[version]` with the latest version from
> [jsr.io/@zanix/datamaster](https://jsr.io/@zanix/datamaster).

---

## 🚀 Basic Usage

**Zanix Datamaster** reads a handful of environment variables for cache/database connectivity and
data protection (masking, encryption, hashing) — see the [Configuration](./docs/configuration.md)
guide for the full list, the versioned-keys naming convention, and security notes on handling them.

Define a model and connect — the recommended way to use Zanix Datamaster:

```ts
import {
  dataPoliciesGetter,
  registerModel,
  ZanixMongoConnector,
} from 'jsr:@zanix/datamaster@[version]'

type Attrs = {
  name: string
  age: number
  email: string
}

// Register a model via DSL definition with schema, seeders, and custom methods
registerModel<Attrs>({
  name: 'users',
  definition: {
    name: String,
    age: Number,
    email: {
      type: String,
      get: dataPoliciesGetter({
        // Masks the value when accessed or returned to the user.
        // Example: 'user@example.com' → '******@example.com'.
        access: {
          strategy: 'protected',
          settings: { virtualMask: { startAfter: 2, endBefore: '@' } },
        },
        // Masks the value before saving it to the database, ensuring sensitive data is stored securely.
        protection: {
          activeVersion: 'v1',
          versionConfigs: {
            v0: { strategy: 'mask' },
            v1: { strategy: 'mask', settings: { endBefore: '@' } },
          },
        },
      }),
    },
  },
  extensions: {
    seeders: [async function seeder(Model: any) {
      const data = await Model.findById('68fb00b33405a3a540d9b971')
      if (data) return
      const user = new Model({
        id: '68fb00b33405a3a540d9b971',
        name: 'pepito',
        age: 30,
      })

      return user.save()
    }],
  },
  callback: (schema) => {
    schema.index({ name: 1, age: 1 }) // covered query
    schema.methods.myMethod = () => 'my value'
    return schema
  },
})

// Mongo connector with seed registration
// (auto-initializes on construction; no manual `initialize()` call needed)
const connector = new ZanixMongoConnector({
  uri: Deno.env.get('MONGO_URI')!,
  seedModel: 'my-seed-register-model',
  config: { dbName: 'my_database' },
})

await connector.isReady

const UsersModel = connector.getModel<Attrs>('users')

// Additionally, you can enable `useALS` if it is currently enabled in the handler (e.g., using @Controller({ enableALS: true })).
// This allows you to avoid manually managing context in data access policies.
// Example: connector.getModel<Attrs>('users', { useALS: true })

const user = await UsersModel.findById('68fb00b33405a3a540d9b971')

console.log(user)

await connector['close']()
```

---

## 📚 Documentation

- [Database](./docs/database.md) — `ZanixMongoConnector`, the `registerModel` DSL, seeders,
  multi-database support, and the SQLite key-value store.
- [Triggers](./docs/triggers.md) — reactive `mail`/`request`/`log`/`custom` actions tied to a
  model's create/update/delete lifecycle, with conditions and worker-based dispatch.
- [Data Protection](./docs/data-protection.md) — masking, encryption, and hashing strategies, access
  strategies, versioned key rotation, and the standalone crypto utilities.
- [Transforms](./docs/transforms.md) — recursive/shallow document transforms and schema inspection
  utilities.
- [Cache](./docs/cache.md) — the Redis connector, the Memcached connector, the local LRU connector,
  and the multi-layer cache provider (`getCachedOrFetch`/`getCachedOrRevalidate`/`withLock`).
- [Observability](./docs/observability.md) — `ZanixElasticsearchConnector` and
  `MeilisearchConnector` (both backing the same `'search'` slot — only one per deployment), and
  `elasticsearchLogSave`, the `@zanix/logger` persistence bridge to Elasticsearch/OpenSearch.
- [DLQ](./docs/dlq.md) — `DlqProvider`, a Mongo-backed dead letter queue for failed business
  processes, with atomic `claim()`-based concurrency, a local `/admin/dlq` REST API
  (`DlqAdminService`/`createDlqAdminController`, `./dlq-api`), a `/.well-known/zanix/dlq` Discovery
  snapshot (`createDlqDiscoveryProvider`), and distributed processing via `@zanix/asyncmq/dlq`'s
  `registerDLQProcessor`.
- [Storage](./docs/storage.md) — `S3ObjectStorage` (a generic S3-compatible byte store) and
  `MongoFileRepository` (a generic file record registry), including optional content encryption at
  rest.
- [Configuration](./docs/configuration.md) — environment variables, defaults, and versioned-key
  naming.

The full API reference (every exported class, function, and type, generated from source) is
published on [jsr.io/@zanix/datamaster](https://jsr.io/@zanix/datamaster/doc). For the broader Zanix
ecosystem, see the [Zanix organization on GitHub](https://github.com/zanix-io).

---

## 🤝 Contributing

1. Open an issue for bugs or feature requests.
2. Fork the repository and create a feature branch.
3. Implement your changes following the project’s guidelines.
4. Add or update tests if applicable.
5. Submit a pull request with a clear description.

---

## 🕒 Changelog

See [`CHANGELOG`](./CHANGELOG.md) for release history.

---

## 📜 License

Licensed under the **MIT License**. See [`LICENSE`](./LICENSE) for details.

---

## 🔗 Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework](https://github.com/zanix-io)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
