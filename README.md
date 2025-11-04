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

**Zanix Datamaster** is part of the **Zanix** ecosystem — a suite of tools for modern
micro-applications. It provides **database and cache connectors** through a unified API for services
like **MongoDB**, **Redis**, and **Memcached** (coming soon).

Currently, it includes full **MongoDB** support, with schema utilities, deep data transformations,
and access & protection policies.

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

- **Model HOC support**
  - Define and load models dynamically with `defineModelHOC`.
  - Supports **seeders**: an array of async/sync functions
    `(Model, connector) => void | Promise<void>` to populate initial data.
  - Allows callbacks to extend schemas with custom methods.
  - Simplifies querying and CRUD operations with the connector instance.

- **Extensible architecture**

  - Ready for future connectors (Redis, Memcached, PostgreSQL).
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
// Mongo connector
import { ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]/database'

// Models HOC
import { defineModelHOC } from 'jsr:@zanix/datamaster@[version]/database'

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

// Utils & types
import {
  findPathsWithAccessorsDeep,
  getAllSubschemas,
} from 'jsr:@zanix/datamaster@[version]/database'
import type {
  EncryptedString,
  HashedString,
  MongoConnectorOptions,
} from 'jsr:@zanix/datamaster@[version]/database'
```

> Replace `[version]` with the latest version from
> [jsr.io/@zanix/datamaster](https://jsr.io/@zanix/datamaster).

---

## 🚀 Basic Usage

### 🔐 Environment Variables

Zanix Datamaster relies on specific environment variables for **database connectivity** and **data
encryption**. Set these before running your application:

| Variable                  | Description                                       | Example                     |
| ------------------------- | ------------------------------------------------- | --------------------------- |
| **`MONGO_URI`**           | Connection URI for MongoDB.                       | `mongodb://localhost:27017` |
| **`DATABASE_AES_KEY`**    | AES key used for symmetric data encryption.       | `my-aes-secret-key`         |
| **`DATABASE_SECRET_KEY`** | Additional secret key for masking/unmasking data. | `supersecret123`            |
| **`DATABASE_RSA_PUB`**    | RSA public key for asymmetric encryption.         | `BASE64...`                 |
| **`DATABASE_RSA_PRIV`**   | RSA private key for asymmetric decryption.        | `-BASE64...`                |

> ⚠️ **Security Note:** Keep your encryption keys safe and **never commit them to version control**.
> These keys are used to protect sensitive field data handled by Zanix Datamaster.

```ts
import { defineModelHOC, ZanixMongoConnector } from 'jsr:@zanix/datamaster@[version]/database'

type Attrs = {
  name: string
  age: number
  email: string
}

// Define a model via HOC with schema, seeders, and custom methods
defineModelHOC<Attrs>({
  name: 'users',
  definition: {
    name: String,
    age: Number,
    email: {
      type: String,
      get: dataPoliciesGetter({
        // Masks the value when accessed or returned to the user.
        // Example: 'user@example.com' → '******@example.com'.
        access: { type: 'protected', virtualMask: { endBefore: '@' } },
        // Masks the value before saving it to the database, ensuring sensitive data is stored securely.
        protection: { type: 'masking' },
      }),
    },
  },
  extensions: {
    seeders: [async (Model: any) => {
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
    schema.methods.myMethod = () => 'my value'
    return schema
  },
})

const connector = new ZanixMongoConnector({
  uri: 'mongodb://localhost:27017',
  config: { dbName: 'my_database' },
  onConnected: () => {
    // Do something
  },
  onDisconnected: () => {
    // Do something
  },
})

await connector.connectorReady

await connector['startConnection']()

const UsersModel = connector.getModel<Attrs>('users')

const user = await UsersModel.findById('68fb00b33405a3a540d9b971')

console.log(user)

await connector['stopConnection']()
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
