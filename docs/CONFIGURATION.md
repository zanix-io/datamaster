# Configuration Reference

Environment variables read by the database/cache connectors and by the data protection utilities.

## Connection variables

| Variable                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Default when unset       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `MONGO_URI`                 | Connection URI used by `ZanixMongoConnector` when no `uri` option is passed to its constructor.                                                                                                                                                                                                                                                                                                                                                              | `mongodb://localhost`    |
| `REDIS_URI`                 | Connection URI used by `ZanixRedisConnector` when no `redisUrl` option is passed to its constructor.                                                                                                                                                                                                                                                                                                                                                         | `redis://localhost:6379` |
| `LOCAL_CACHE_MAX_ITEMS`     | Maximum number of items `ZanixQLRUConnector` holds before evicting the least recently used entry.                                                                                                                                                                                                                                                                                                                                                            | `50000`                  |
| `DATABASE_SEEDERS`          | Set to `'false'` to globally disable seeder execution for both `registerModel`'s DSL seeders and schema-based seeders (any other value, including unset, keeps seeders enabled).                                                                                                                                                                                                                                                                             | seeders enabled          |
| `SEED_MODEL_NAME`           | Names `ZanixMongoConnector`'s seed-tracking model when no `seedModel` option is passed. `'false'` disables it, same as `seedModel: false`.                                                                                                                                                                                                                                                                                                                   | `zanix-seeders`          |
| `TRIGGERS_MODEL_NAME`       | Names `ZanixMongoConnector`'s persisted triggers model when no `triggersModel` option is passed. `'false'` disables it, same as `triggersModel: false`.                                                                                                                                                                                                                                                                                                      | `zanix-triggers`         |
| `TRIGGERS_POLL_INTERVAL`    | Milliseconds between persisted-trigger polls when no `triggersPollInterval` option is passed — see [Triggers: keeping the registry fresh](./TRIGGERS.md#keeping-the-registry-fresh-without-a-restart). Unset, `'false'`, or non-positive/non-numeric all disable it.                                                                                                                                                                                         | polling disabled         |
| `TRIGGERS_CHANGE_STREAM`    | Set to `'true'` to watch persisted triggers via a Change Stream when no `triggersChangeStream` option is passed — see the same section above.                                                                                                                                                                                                                                                                                                                | disabled                 |
| `AUTO_PROTECT_ON_DB_UPDATE` | On by default for every model that doesn't set the `extensions.autoProtectOnUpdate` option explicitly. Set to the literal `'false'` to opt out — see [Data Protection: automatic update-time protection](./DATA-PROTECTION.md#automatic-update-time-protection-autoprotectonupdate). Only covers document-level `.save()`; never `updateOne`/`findOneAndUpdate`/`bulkWrite` (opt into those per-call instead, via `useDataPolicies` — see the same section). | enabled                  |
| `ELASTICSEARCH_URL`         | Cluster URL used by `ZanixElasticsearchConnector` when no `node` option is passed. Checked before `OPENSEARCH_URL`. Also gates auto-registration of the default connector when importing `./core` — see [Observability](./OBSERVABILITY.md).                                                                                                                                                                                                                 | `http://localhost:9200`  |
| `OPENSEARCH_URL`            | Same as `ELASTICSEARCH_URL`, checked second (only if `ELASTICSEARCH_URL` is unset).                                                                                                                                                                                                                                                                                                                                                                          | `http://localhost:9200`  |
| `ELASTICSEARCH_API_KEY`     | API-key credential used by `ZanixElasticsearchConnector` when no `auth` option is passed. Checked before `OPENSEARCH_API_KEY`. Basic auth has no env var counterpart — embed it directly in the URL instead (`https://user:pass@host:9200`), see [Observability](./OBSERVABILITY.md).                                                                                                                                                                        | auth disabled            |
| `OPENSEARCH_API_KEY`        | Same as `ELASTICSEARCH_API_KEY`, checked second (only if `ELASTICSEARCH_API_KEY` is unset).                                                                                                                                                                                                                                                                                                                                                                  | auth disabled            |
| `DLQ_MODEL_NAME`            | Names `DLQProvider`'s collection. Always wins over `registerDLQModel`'s `modelName` option when set — see [DLQ](./DLQ.md#configuration).                                                                                                                                                                                                                                                                                                                     | `zanix-dlq`              |
| `DLQ_ENCRYPT_PAYLOAD`       | Set to `'true'`/`'false'` to force `registerDLQModel`'s `encryptPayload` on or off — always wins over the option when set. See [DLQ: Protecting the payload](./DLQ.md#protecting-the-payload).                                                                                                                                                                                                                                                               | off                      |
| `DLQ_DEFAULT_LEASE_MS`      | Default `DLQProvider.claim()` lease duration (ms) when no per-call `leaseTtlMs` is passed. Always wins over `registerDLQModel`'s `defaultLeaseMs` option when set.                                                                                                                                                                                                                                                                                           | `30000`                  |
| `FILE_MODEL_NAME`           | Names `MongoFileRepository`'s collection when no `modelName` option is passed to `registerFileModel`. See [Storage](./STORAGE.md).                                                                                                                                                                                                                                                                                                                           | `zanix-files`            |
| `SEAWEEDFS_S3_ENDPOINT`     | S3 gateway endpoint used by `SeaweedFSObjectStorage` when no `endpoint` option is passed. Also gates auto-registration of the default connector when importing `./storage/core.ts` — see [Storage](./STORAGE.md).                                                                                                                                                                                                                                            | `http://localhost:8333`  |
| `SEAWEEDFS_ACCESS_KEY`      | SigV4 access key used by `SeaweedFSObjectStorage` when no `accessKeyId` option is passed.                                                                                                                                                                                                                                                                                                                                                                    | none                     |
| `SEAWEEDFS_SECRET_KEY`      | SigV4 secret key used by `SeaweedFSObjectStorage` when no `secretAccessKey` option is passed.                                                                                                                                                                                                                                                                                                                                                                | none                     |
| `SEAWEEDFS_BUCKET`          | Bucket used by `SeaweedFSObjectStorage` when no `bucket` option is passed.                                                                                                                                                                                                                                                                                                                                                                                   | `zanix-objects`          |
| `SEAWEEDFS_ENCRYPT`         | `'symmetric'`/`'asymmetric'` — enables encryption when no `encrypt` option is passed. The only way to enable it on the connector instance the standard `@Connector`/DI boot path constructs. See [Storage](./STORAGE.md#encrypting-object-content-at-rest).                                                                                                                                                                                                  | encryption off           |
| `SEAWEEDFS_ENCRYPT_VERSION` | Sets `encrypt.version` when `SEAWEEDFS_ENCRYPT` is set. Ignored otherwise.                                                                                                                                                                                                                                                                                                                                                                                   | `v0`                     |

An explicit constructor option always takes precedence over its matching environment variable (e.g.
`new ZanixMongoConnector({ uri: '...' })` wins over `MONGO_URI`) — the env var only applies when the
option is omitted entirely, not merely falsy.

## Data protection variables

Read by `dataProtectionGetter`/`dataPoliciesGetter` and by the standalone `datamasterEncrypt`,
`datamasterDecrypt`, `datamasterMask`, `datamasterUnmask` utilities — see
[Data Protection](./DATA-PROTECTION.md) for what each strategy actually does. `DATA_AES_KEY`/
`DATA_RSA_PUB`/`DATA_RSA_KEY` are also the keys `SeaweedFSObjectStorage`'s `encrypt` option reads —
see [Storage: Encrypting object content at rest](./STORAGE.md#encrypting-object-content-at-rest).

| Variable          | Used for                                      | Notes                                                                          |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATA_SECRET_KEY` | Masking/unmasking.                            | Checked first; falls back to `DATA_AES_KEY` if unset.                          |
| `DATA_AES_KEY`    | Symmetric encryption, and masking's fallback. | Value is used directly (not base64-decoded).                                   |
| `DATA_RSA_PUB`    | Asymmetric **encryption**.                    | Must contain a **base64-encoded** public key — it's `atob()`-decoded on read.  |
| `DATA_RSA_KEY`    | Asymmetric **decryption**.                    | Must contain a **base64-encoded** private key — it's `atob()`-decoded on read. |

### Versioned keys

Every one of the variables above can be suffixed with a version to support key rotation without
downtime: append `_V1`, `_V2`, etc. to the base name (e.g. `DATA_AES_KEY_V1`, `DATA_RSA_PUB_V1`). A
`DataProtectionOptions`/`DataFieldAccess` config can declare an `activeVersion` and a
`versionConfigs` map so different documents (or the same document over time) resolve to different
strategies/settings per version.

If no version is specified (or the version is `'v0'`), the **unsuffixed** variable is used — `v0` is
treated as the implicit default and never gets a suffix.

| Strategy              | Example variables                               |
| --------------------- | ----------------------------------------------- |
| Masking               | `DATA_SECRET_KEY_V1`, `DATA_SECRET_KEY_V2`, ... |
| Symmetric encryption  | `DATA_AES_KEY_V1`, `DATA_AES_KEY_V2`, ...       |
| Asymmetric encryption | `DATA_RSA_PUB_V1`, `DATA_RSA_KEY_V1`, ...       |

Rotate keys programmatically with `seedRotateProtectionKeys()` — see
[Data Protection: key rotation](./DATA-PROTECTION.md#key-rotation).

## Security

- **Never commit encryption keys to version control.** During key rotation, keep every key version
  accessible until all existing data has been re-encrypted under the new version — verify this with
  `checkProtectionRotationStatus()` rather than assuming one `seedRotateProtectionKeys()` run
  reached every document, see [Data Protection: key rotation](./DATA-PROTECTION.md#key-rotation).
- **Never store sensitive data in plaintext** in an external cache. Only cache ephemeral or already
  protected data, with a short TTL and a secure connection. Prefer applying data protection policies
  at the database level, or the standalone `datamasterEncrypt`/`datamasterDecrypt`,
  `datamasterMask`/`datamasterUnmask`, `datamasterHash` utilities for anything cached — see
  [Data Protection](./DATA-PROTECTION.md).
- **Never hardcode secrets in a trigger definition** (`extensions.triggers`) — a `headers`/`body`/
  `url` field with a literal API key, token, or password is exposed to anyone who can read that
  config, not just whoever executes the trigger. Reference any variable name you choose with
  `${{VARIABLE_NAME}}` instead; unlike the fixed variables in this document, this one reads whatever
  name you reference from `Deno.env` — see
  [Triggers: environment variable interpolation](./TRIGGERS.md#environment-variable-interpolation-env_var).

## See also

- [Data Protection](./DATA-PROTECTION.md) — what each strategy does and how versioned keys and
  rotation actually work.
- [Database](./DATABASE.md) — `ZanixMongoConnector` construction options and multi-database model
  names.
- [Cache](./CACHE.md) — `ZanixRedisConnector`/`ZanixQLRUConnector` construction options.
- [Triggers](./TRIGGERS.md) — `${{ENV_VAR}}` interpolation for secrets referenced from a trigger
  definition.
- [Observability](./OBSERVABILITY.md) — `ZanixElasticsearchConnector`/`elasticsearchLogSave`
  construction options.
- [DLQ](./DLQ.md) — `DLQProvider`/`registerDLQModel` construction options and the concurrency model.
- [Storage](./STORAGE.md) — `SeaweedFSObjectStorage`/`MongoFileRepository` construction options and
  content encryption.
