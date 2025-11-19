# Zanix – Datamaster

[![Version](https://img.shields.io/jsr/v/@zanix/datamaster?color=blue&label=jsr)](https://jsr.io/@zanix/datamaster/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/datamaster?color=blue&label=git)](https://github.com/zanix-io/datamaster/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

- [Description](#🧩-description)
- [Features](#⚙️-features)
- [Installation](#📦-installation)
- [Basic Usage](#🚀-basic-usage)
- [Documentation](#📚-documentation)
- [Contributing](#🤝-contributing)
- [Changelog](#🕒-changelog)
- [License](#⚖️-license)
- [Resources](#🔗-resources)

---

## 🧩 Description

**Zanix Datamaster** is a core component of the **Zanix** ecosystem — a toolkit designed for modern
micro-applications. It offers a **unified API for database and cache connectors**, supporting
services such as **MongoDB**, **Redis**, **SQLite** (as a KV store), and **Memcached** (coming
soon).

Out of the box, it provides full support for **MongoDB**, **Redis**, and **KV stores**, including
schema management utilities, advanced data transformations, robust access and protection policies,
local caching utilities, such as in-memory Map for fast, etc.

> 💡 Special thanks to the external database and cache providers whose technologies make this module
> possible.

---

## ⚙️ Features

- **MongoDB connector**

  - Native `ZanixMongoConnector` class.
  - Deep schema utilities & accessor helpers.
  - Recursive and shallow data transformations.
  - Built-in data access and protection policies.
  - `AsyncLocalStorage` (ALS) support.

- **Redis connector**

  - Native `ZanixRedisConnector` class.
  - Optimized connection pooling and async operations.
  - Supports pub/sub, key expiration, and data serialization.
  - Designed for caching, queueing, and distributed locking.

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

- **Queues & concurrency helpers**
  - **Semaphores**: Limit the number of concurrent operations with FIFO queuing.
  - **Keyed Lock Manager**: Provides exclusive, per-key locks for safe serialized operations **in
    non-distributed systems**.

- **Cache provider & strategies**

  - `getCachedOrFetch`: Retrieves a value from cache with local fallback and optional fetch.
  - `getCachedOrRevalidate`: Retrieves a cached value using a soft TTL strategy and local fallback.
  - Unified API for managing multi-layer caching (Redis + local).
  - Customizable cache adapters and TTL policies.
  - `withLock`: Ensures serialized, concurrency-safe operations for a given cache key **in
    non-distributed systems**.
    - Prevents race conditions in write-heavy scenarios.
    - Guarantees only one mutation for the same key runs at a time.
    - Built on top of the `LockManager` and semaphores for predictable and safe execution.

- **Model DSL definition support (Database Only)**

  - Define and load models dynamically with `registerModel`.
  - Supports **seeders**: an array of async/sync functions
    `(Model, connector) => void | Promise<void>` to populate initial data.
  - Allows callbacks to extend schemas with custom methods.
  - Simplifies querying and CRUD operations with the connector instance.

- **Extensible architecture**

  - Ready for future connectors (Memcached, PostgreSQL).
  - Organized exports:

    - `./cache` → cache systems.
    - `./database` → database connectors.

- **Seamless Zanix integration**

  - Works perfectly with [`@zanix/server`](https://jsr.io/@zanix/server).

---

## 📦 Installation

Install via **JSR** using [Deno](https://deno.com/):

```ts
import * as datamaster from 'jsr:@zanix/datamaster@[version]'
```

Or import specific modules:

```ts
/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * *************************************************
 * CACHE *******************************************
 * *************************************************
 */

// Connectors & providers
export {
  ZanixCacheCoreProvider,
  ZanixQLRUConnector,
  ZanixRedisConnector,
} from 'jsr:@zanix/datamaster@[version]/cache'

/**
 * *************************************************
 * DATABASE ****************************************
 * *************************************************
 */

// Mongo connector
import { Schema, ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]/database'

// Models DSL definition
import { registerModel } from 'jsr:@zanix/datamaster@[version]/database'

// Access & protection policies
import {
  dataAccessGetter,
  dataPoliciesGetter,
  dataProtectionGetter,
} from 'jsr:@zanix/datamaster@[version]/database'

// Transform utilities
import {
  transformByDataAccess,
  transformDeepByPaths,
  transformRecursively,
  transformShallowByPaths,
} from 'jsr:@zanix/datamaster@[version]/database'

// Seeders
import {
  seedByIdIfMissing,
  seedManyByIdIfMissing,
  seedRotateProtectionKeys,
} from 'jsr:@zanix/datamaster@[version]/database'

// Utils & types
import {
  findPathsWithAccessorsDeep,
  getAllSubschemas,
} from 'jsr:@zanix/datamaster@[version]/database'

// SQLite
import { LocalSQLite, ZanixKVStoreConnector } from 'jsr:@zanix/datamaster@[version]/database'

/**
 * *************************************************
 * GENERAL *****************************************
 * *************************************************
 */

// Data protection
export {
  createDecryptableObject,
  createHashFrom as datamasterHash,
  createUnmaskableObject,
  createVerifiableObject,
  decrypt as datamasterDecrypt,
  encrypt as datamasterEncrypt,
  mask as datamasterMask,
  unmask as datamasterUnmask,
} from 'utils/protection.ts'

// Queues Utils
export { LockManager } from 'utils/queues/lock-manager.ts'
export { Semaphore } from 'utils/queues/semaphore.ts'

// General types
export type { DecryptableObject, UnmaskableObject, VerifiableObject } from 'typings/data.ts'
```

> Replace `[version]` with the latest version from
> [jsr.io/@zanix/datamaster](https://jsr.io/@zanix/datamaster).

---

## 🚀 Basic Usage

### 🔐 Environment Variables

**Zanix Datamaster** uses specific environment variables for **cache/database connectivity** and
**data protection** (masking, encryption, and hashing). These must be set before running your
application.

| Variable                    | Description                                                                                                           | Example Value               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **`MONGO_URI`**             | Connection URI for MongoDB.                                                                                           | `mongodb://localhost:27017` |
| **`DATA_AES_KEY`**          | AES key used for symmetric data encryption.                                                                           | `my-aes-secret-key`         |
| **`DATA_SECRET_KEY`**       | Additional secret key for masking/unmasking data.                                                                     | `supersecret123`            |
| **`DATA_RSA_PUB`**          | RSA public key for asymmetric encryption.                                                                             | `BASE64...`                 |
| **`DATA_RSA_PRIV`**         | RSA private key for asymmetric decryption.                                                                            | `BASE64...`                 |
| **`REDIS_URI`**             | Connection URI for Redis cache.                                                                                       | `redis://localhost:6379`    |
| **`LOCAL_CACHE_MAX_ITEMS`** | Maximum number of items in the local in-memory cache. Uses a Least Recently Used (LRU) strategy. Defaults to `50000`. | `1000`                      |

#### 🌐 Versioned Keys

Zanix supports **versioned environment variables** for controlled key rotation and migration on data
protection policies. Simply append a version suffix (e.g. `_V1`, `_V2`, etc.) to your environment
variable names:

| Strategy                  | Example Variables                               |
| ------------------------- | ----------------------------------------------- |
| **Symmetric encryption**  | `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, ...       |
| **Asymmetric encryption** | `DATA_RSA_PUB_V1`, `DATA_RSA_KEY_V1`, ...       |
| **Masking**               | `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, ... |

If no version is specified, Zanix defaults to **v0** (non-suffixed variables). Key versions can be
managed programmatically and rotated using the utility:

```ts
seedRotateProtectionKeys()
```

---

⚠️ **Security:**

- **Encryption Keys:** Never commit encryption keys to version control. During key rotation, keep
  all key versions accessible until data is re-encrypted.
- **External Caching / Storage:** Never store sensitive data in plaintext. Only cache ephemeral or
  encrypted data, using short TTLs and secure connections. Always apply data protection policies on
  databases, or use data protection utilities such as `datamasterEncrypt`/`Decrypt`,
  `datamasterMask`/`Unmask`, `datamasterHash`/`createVerifyObject` (or `validateHash` from
  `zanix/utils`).

---

#### Example

```ts
import { registerModel, ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]/database'

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
const connector = new ZanixMongoConnector({
  uri: process.env.MONGO_URI!,
  seedModel: 'my-seed-register-model',
  config: { dbName: 'my_database' },
})

await connector.connectorReady

await connector['initialize']()

const UsersModel = connector.getModel<Attrs>('users')

const user = await UsersModel.findById('68fb00b33405a3a540d9b971')

console.log(user)

await connector['close']()
```

---

## 📚 Documentation

See the full documentation and examples at: 🔗
[https://github.com/zanix-io](https://github.com/zanix-io)

---

## 🤝 Contributing

1. Open an issue for bugs or feature requests.
2. Fork the repository and create a feature branch.
3. Implement your changes following the project’s guidelines.
4. Add or update tests if applicable.
5. Submit a pull request with a clear description.

---

## 🕒 Changelog

See [`CHANGELOG`](./docs/CHANGELOG.md) for release history.

---

## ⚖️ License

Licensed under the **MIT License**. See [`LICENSE`](./docs/LICENSE) for details.

---

## 🔗 Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework](https://github.com/zanix-io)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
