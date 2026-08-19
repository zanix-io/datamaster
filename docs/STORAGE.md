# Storage

`SeaweedFSObjectStorage` and `MongoFileRepository` — a generic byte store and a generic file record
registry. Both are deliberately agnostic of what's being stored or by whom: neither has any notion
of a specific domain, file kind, or processing state. Bytes and metadata are two independent
concerns, backed by two independent modules: `./storage` (`SeaweedFSObjectStorage`) never touches
file metadata, and `./files` (`MongoFileRepository`) never touches object content.

## Architecture

```
./storage  -> SeaweedFSObjectStorage, a byte store keyed by an opaque string, backed by a real
              @aws-sdk/client-s3 S3Client pointed at a SeaweedFS S3 gateway.
./files    -> MongoFileRepository, a generic file record registry backed by ZanixMongoConnector.
```

Neither module assumes the other is in use — an application can use `SeaweedFSObjectStorage` alone
for raw byte storage, `MongoFileRepository` alone for tracking file records against some other
backend, or both together for a full store-and-track setup.

## `SeaweedFSObjectStorage`

Wraps a real `@aws-sdk/client-s3` `S3Client` (`forcePathStyle: true` — SeaweedFS doesn't support
virtual-hosted-style addressing) against a [SeaweedFS](https://github.com/seaweedfs/seaweedfs) S3
gateway. Registers the `'s3'` core connector slot (the same `registerCoreConnectorSlot` mechanism
`'database'`/`'search'` already use). `'s3'` isn't one of the framework's six hardcoded slots, so
there's no dedicated `this.s3` getter — resolve it via `this.connectors.get('s3')`/
`this.getProviderConnector('s3')` inside a `ZanixProvider`, or
`ProgramModule.getConnectors(undefined, false).get('s3')` anywhere else.

```ts
import { SeaweedFSObjectStorage } from 'jsr:@zanix/datamaster@[version]/storage'

const storage = new SeaweedFSObjectStorage({
  endpoint: 'http://localhost:8333', // falls back to SEAWEEDFS_S3_ENDPOINT
  accessKeyId: 'access-key', // falls back to SEAWEEDFS_ACCESS_KEY
  secretAccessKey: 'secret-key', // falls back to SEAWEEDFS_SECRET_KEY
  bucket: 'zanix-objects', // falls back to SEAWEEDFS_BUCKET
})

const stored = await storage.put('some/opaque/key', bytes, { contentType: 'application/pdf' })
const found = await storage.get('some/opaque/key') // undefined if it doesn't exist
await storage.delete('some/opaque/key') // a no-op if it doesn't exist
```

Or auto-register the default connector by importing `./core` and setting `SEAWEEDFS_S3_ENDPOINT` —
same convention as `ZanixElasticsearchConnector`'s own `./core` loader.

A missing object (`NoSuchKey`/`NotFound`) resolves to `undefined`/`false`. Every other failure
(connectivity, auth, a misconfigured bucket) propagates unmapped, consistent with this package's
existing connectors.

### Encrypting object content at rest

Off by default. Enable it with the `encrypt` option:

```ts
new SeaweedFSObjectStorage({ encrypt: { type: 'symmetric' } }) // AES-GCM, DATA_AES_KEY
new SeaweedFSObjectStorage({ encrypt: { type: 'asymmetric' } }) // RSA-wrapped per-object AES key
```

Or via `SEAWEEDFS_ENCRYPT=symmetric`/`SEAWEEDFS_ENCRYPT=asymmetric` (plus optionally
`SEAWEEDFS_ENCRYPT_VERSION`) when no `encrypt` option is passed — the only way to enable it on the
connector instance the standard `@Connector`/DI boot path constructs, since that path never receives
custom constructor arguments. An explicit `encrypt` option always wins over both env vars.

Passing the literal `encrypt: false` is different from omitting the option: it explicitly forces
encryption OFF for that one instance, even when `SEAWEEDFS_ENCRYPT` enables it process-wide.
Omitting `encrypt` entirely means "no opinion" — the env var applies. This matters for any instance
that genuinely needs an unencrypted view alongside an encrypted one (a migration tool reading raw
bytes to re-encrypt them under a new key; a diagnostic connector) — without it, a second instance
constructed with no `encrypt` key would silently inherit the env var too.

Reuses the exact same `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY` environment variables this
package's own [Data Protection](./DATA-PROTECTION.md) strategies already use — see
[Configuration](./CONFIGURATION.md#data-protection-variables) for their exact semantics
(`DATA_RSA_PUB`/`DATA_RSA_KEY` are base64-encoded PEM, `DATA_AES_KEY` is used as-is). No separate
storage-specific key variables exist.

`'symmetric'` encrypts an object's bytes directly with `DATA_AES_KEY`. `'asymmetric'` uses real
envelope encryption: RSA-OAEP can't encrypt an arbitrary-size payload directly (a hard ceiling well
below a typical object's size), so a random AES key is generated per object, that key encrypts the
bytes, and only the small key itself is RSA-encrypted with `DATA_RSA_PUB` and stored alongside the
object as S3 metadata (`x-amz-meta-wrapped-key`) — recovered with `DATA_RSA_KEY` on read.

Unlike `dataProtectionGetter('encrypt')`/the standalone `datamasterEncrypt`/`datamasterDecrypt`
helpers (which log and silently return the original value if the configured key is missing or
invalid — an acceptable trade-off for a masked field, since the write still succeeds), a missing or
invalid key here throws: `put()`/`get()` either genuinely encrypt/decrypt the object or fail loudly.
Silently persisting plaintext bytes under an "encrypted" label would be a real confidentiality
incident, not a degraded write.

#### Key rotation

`encrypt.version` selects a versioned key for new writes — the exact same `_V1`/`_V2`/... convention
[Configuration](./CONFIGURATION.md#versioned-keys) already documents for field-level protection,
reusing the same env vars (`DATA_AES_KEY_V1`, `DATA_RSA_PUB_V1`/`DATA_RSA_KEY_V1`, ...):

```ts
new SeaweedFSObjectStorage({ encrypt: { type: 'symmetric', version: 'v1' } })
```

Rotating `version` only changes what NEW objects are encrypted under. Each object's own version is
recorded as storage metadata (`x-amz-meta-encryption-version`) at `put()` time and read back at
`get()` time, so an existing object always decrypts with the key version it was actually written
under — never with whatever version is currently active. As with field-level rotation, keep every
key version an object still depends on available; removing one before all its objects have been
re-encrypted under a newer version makes those objects permanently unreadable.

Encryption doesn't change an object's identity: its checksum is always computed over the plaintext,
before any encryption is applied — the same value regardless of whether encryption is enabled.

Only `encrypt.version` is object-scoped rotation: an object's `type` (`'symmetric'`/`'asymmetric'`)
is **not** recorded per object, only its version is (`x-amz-meta-encryption-version`). Both
`get()`/`rotateEncryptionKeys()` decrypt using the _current instance's_ configured `type`, so
switching an instance's `encrypt.type` while it still holds objects encrypted under the previous
type is unsupported — `rotateEncryptionKeys()` itself decrypts with the same instance it re-encrypts
with, so it cannot bridge a `type` change either. Keep `type` fixed for a given bucket/prefix; only
rotate `version`.

#### Migrating already-stored objects to a new key version

Rotating `encrypt.version` only changes what NEW writes use — it never retroactively re-encrypts
objects already in the bucket. `checkEncryptionRotationStatus()`/`rotateEncryptionKeys()`
(`storage/rotation.ts`) are the explicit migration step, mirroring
`checkProtectionRotationStatus()`/`seedRotateProtectionKeys()`'s own role for field-level protection
([Configuration](./CONFIGURATION.md#versioned-keys)): one reports status, the other migrates.

```ts
import { checkEncryptionRotationStatus, rotateEncryptionKeys } from '@zanix/datamaster/storage'

// 1. Rotate: reconfigure the connector to encrypt new writes under the new version (e.g. `v2`).
const storage = new SeaweedFSObjectStorage({ encrypt: { type: 'symmetric', version: 'v2' } })

// 2. Migrate existing objects still on an older version (or never encrypted at all) to v2.
const result = await rotateEncryptionKeys(storage)
// { scanned, migrated, skipped, failed: [{ key, error }, ...] }

// 3. Confirm it's safe to remove the old key version from the environment.
const status = await checkEncryptionRotationStatus(storage)
// { activeVersion, totalObjects, onActiveVersion, versionsStillInUse, unencrypted, safeToRetireOldKeys }
```

Both enumerate the bucket via `SeaweedFSObjectStorage.listPage()`/`getMetadata()` —
SeaweedFS-specific methods deliberately kept off the generic `ObjectStorage` port (see
[Architecture](#architecture)), so this migration is entirely self-contained and never depends on
`MongoFileRepository` or any other metadata registry.

`rotateEncryptionKeys()` is safe to run repeatedly: an object already on the active version is
skipped cheaply (a metadata check, no decrypt/re-encrypt round trip), so re-running after fixing a
batch of `failed` entries — or after a `checkEncryptionRotationStatus()` run still shows old
versions in use — just picks up where it left off. Per-key failures are collected in `result.failed`
rather than aborting the whole run, the same resilience `seedRotateProtectionKeys()` already has for
documents.

**Concurrency**: an object created while a rotation runs is never a problem — new writes already
land on the active version. An object overwritten by the application between the migration's own
read and write of that same key is a real race, handled by re-checking the object's own checksum
immediately before writing; if it changed, that key is skipped for this round (never overwritten)
and picked up cleanly by the next run.

**`useWorker`**: both functions accept `useWorker: 'one-time' | 'persisted'` to run the scan/
migration off the calling thread — worth it for a bucket large enough that the work runs long. Same
two dispatch strategies (and the same automatic `'persisted'` → `'one-time'` fallback when no
`'worker'` core provider is registered) as every other `useWorker` option in this ecosystem, e.g.
`elasticsearchLogSave` above. `onProgress` and `useWorker` are mutually exclusive on
`rotateEncryptionKeys()` — a progress callback can't cross the worker-thread boundary, so pick one:
run inline with live progress, or run in a worker and just await the final result.

```ts
await rotateEncryptionKeys(storage, { useWorker: 'persisted' })
```

### Local fallback and migration

Three generic `ObjectStorage` combinators — none of them SeaweedFS-specific, and none of them assume
anything about what's being stored:

- **`createLocalFilesystemObjectStorage(rootDir)`** — a real, disk-backed `ObjectStorage`. Not the
  intended production store; exists for local development with zero external infra, and as the local
  half of the fallback below.
- **`createFallbackObjectStorage(primary, fallback, ensureSynced?)`** — wraps two `ObjectStorage`s:
  `put()` always writes to `primary` only; `get()`/`exists()` try `primary` first, falling back to
  `fallback` on a miss; `delete()` removes from both. Exists for one real scenario: `primary`
  (typically `SeaweedFSObjectStorage`) becomes unreachable for a while, objects get written to
  `fallback` in the meantime, then `primary` comes back — reads for those objects must never come
  back empty just because the active backend changed.
- **`ensureLocalObjectsSynced(local, primary, rootDir)`** — a one-time, lazy, memoized copy of every
  object found only in `local` into `primary`, the same "sync on first real use, once per process"
  pattern `@zanix/notifications`' own `LocalTemplateBackend` establishes. Existence-based, not
  content-diffed (objects are immutable once written). Pass it as `createFallbackObjectStorage`'s
  own `ensureSynced` callback — its failure is logged, never thrown, since the per-key fallback
  above already covers reads/writes regardless of whether the bulk migration ever succeeds.

```ts
import {
  createFallbackObjectStorage,
  createLocalFilesystemObjectStorage,
  ensureLocalObjectsSynced,
  SeaweedFSObjectStorage,
} from 'jsr:@zanix/datamaster@[version]/storage'

const primary = new SeaweedFSObjectStorage()
const local = createLocalFilesystemObjectStorage('./local-objects')
const storage = createFallbackObjectStorage(
  primary,
  local,
  () => ensureLocalObjectsSynced(local, primary, './local-objects'),
)
```

`@zanix/core`'s own `Zanix.setup({ assets: { localDir } })` builds exactly this composition
automatically when constructing its `AssetService` — see that package's own docs.

### Testing against a real local SeaweedFS

`src/@tests/functional/storage/seaweedfs-object-storage.test.ts` exercises the full `put`/`get`/
`exists`/`delete` lifecycle against a real instance. Skipped by default; enable it exactly like the
Elasticsearch/OpenSearch functional suite:

1. Start a local SeaweedFS with the S3 gateway enabled:

   ```sh
   docker run -d --name zanix-seaweedfs-test \
     -p 8333:8333 \
     chrislusf/seaweedfs server -s3
   ```

2. Copy `src/@tests/.env.test.example` to `src/@tests/.env.test` and set `RUN_SEAWEEDFS_TESTS=true`.
3. Run: `deno test --allow-all src/@tests/functional/storage/`

`RUN_SEAWEEDFS_TESTS` gates _whether the test runs at all_ — it does not check whether SeaweedFS is
actually reachable. If the flag is set but no SeaweedFS is listening, the test runs for real and
fails with a real connectivity error, exactly as it should: enabling integration tests is a
commitment to having the integration available, not a soft hint.

## `MongoFileRepository`

A generic, durable file record registry, backed by `ZanixMongoConnector`. Follows the same
`@Provider`/`ZanixProvider` shape as `TriggersAdminRepository`/`DLQProvider` (see
[Database](./DATABASE.md)).

```ts
import { registerFileModel } from 'jsr:@zanix/datamaster@[version]/files'

registerFileModel() // default connector, default collection name (zanix-files)
registerFileModel({ modelName: 'app-files' })
```

A record's fields (`key`, `contentType`, `size`, `checksum`, `filename`) describe a generic stored
file — nothing here assumes a processing pipeline, a status, or a specific file kind. A free-form
`metadata: Record<string, unknown>` field is the one place a caller attaches whatever
domain-specific data it needs; this package never interprets its contents.

The caller-assigned record id is persisted as the document's native `_id` rather than a separate
business-key field — `create()`/`findById()`/`update()`/`delete()` all key directly off it.
`update()` throws `HttpError('NOT_FOUND')` for a missing id; `delete()` is a no-op for one.

## Types & constants reference

The prose above describes every shape inline; this table just names the exported symbols behind it,
for anyone browsing `./storage`'s exports directly:

| Symbol                                                                                                                                                                | What it is                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ObjectStorage`                                                                                                                                                       | The generic port `SeaweedFSObjectStorage` implements — `put`/`get`/`delete`/`exists`.                                                                                              |
| `StoredObject`                                                                                                                                                        | An object's own properties as returned by `put()`/`get()`: `{ key, contentType, size, checksum }`.                                                                                 |
| `SeaweedFSConnectorOptions`                                                                                                                                           | Constructor options: `endpoint`, `accessKeyId`, `secretAccessKey`, `bucket`, `encrypt` — see [above](#seaweedfsobjectstorage).                                                     |
| `StorageEncryptSettings`                                                                                                                                              | `EncryptSettings` plus an optional `version` — this module's own key-rotation extension.                                                                                           |
| `EncryptSettings`, `DataPolicyVersion`                                                                                                                                | Shared data-protection types this module reuses unchanged — see [Data Protection](./DATA-PROTECTION.md).                                                                           |
| `EncryptionRotationOptions`, `EncryptionRotationStatus`, `EncryptionRotationStatusOptions`, `RotationResult`                                                          | Parameter/return types behind `checkEncryptionRotationStatus()`/`rotateEncryptionKeys()` — shapes shown inline [above](#migrating-already-stored-objects-to-a-new-key-version).    |
| `SEAWEEDFS_S3_ENDPOINT_ENV`, `SEAWEEDFS_ACCESS_KEY_ENV`, `SEAWEEDFS_SECRET_KEY_ENV`, `SEAWEEDFS_BUCKET_ENV`, `SEAWEEDFS_ENCRYPT_ENV`, `SEAWEEDFS_ENCRYPT_VERSION_ENV` | Typed string constants for the env var names documented in [Configuration](./CONFIGURATION.md) — e.g. `Deno.env.get(SEAWEEDFS_S3_ENDPOINT_ENV)` instead of hardcoding the literal. |

## See also

- [Configuration](./CONFIGURATION.md) — every environment variable this package reads, including
  `SEAWEEDFS_*` and the reused `DATA_AES_KEY`/`DATA_RSA_PUB`/`DATA_RSA_KEY`.
- [Data Protection](./DATA-PROTECTION.md) — the encryption strategy `SeaweedFSObjectStorage`'s
  `encrypt` option reuses.
- [Database](./DATABASE.md) — `ZanixMongoConnector`/`registerModel`, the pattern
  `MongoFileRepository` follows.
