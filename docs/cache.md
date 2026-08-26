# Cache

Local (in-memory), Redis-backed, and Memcached-backed caching, plus the multi-layer cache provider
that combines the local layer with Redis.

## Redis connector

```ts
import { ZanixRedisConnector } from 'jsr:@zanix/datamaster@[version]'

const redis = new ZanixRedisConnector({
  redisUrl: Deno.env.get('REDIS_URI'), // falls back to REDIS_URI env var, then 'redis://localhost:6379'
  ttl: 60, // seconds; 0 (default) = never expires
  maxCommandRetries: 3,
  commandTimeout: 2000,
})

await redis.isReady

await redis.set('user:1', { name: 'Ada' })
const user = await redis.get('user:1')
```

`RedisOptions` also accepts `commandRetryInterval` (ms between retries, default `100`),
`connectionTimeout` (ms to wait for the initial connection), `reconnectStrategy` (defaults to capped
exponential backoff, `min(retries * 100, 5000)`ms), and `schedulerOptions` (see
[Command scheduling](#command-scheduling) below).

Every method (`set`/`get`/`has`/`delete`/`clear`/`size`/`keys`/`values`) runs through an automatic
retry wrapper. `clear()` flushes the **entire** Redis database, not just keys this connector wrote.
`isHealthy()` reflects a `connected` flag toggled by the client's own `ready`/`end`/`reconnecting`
events — it doesn't ping Redis on each call. `getClient()` returns the raw underlying `redis` npm
client (still wrapped in the retry logic) for anything not covered by the connector's own methods
(e.g. running a Lua script via `EVAL`).

### Command scheduling

Passing `{ schedule: true }` to `set()` batches the write into a `RedisPipelineScheduler` instead of
sending it immediately — the scheduler flushes automatically once `schedulerOptions.maxBatch`
commands have queued up, or after `schedulerOptions.maxDelay`ms, whichever comes first (defaults:
`200` commands / `100`ms).

## Memcached connector

```ts
import { ZanixMemcachedConnector } from 'jsr:@zanix/datamaster@[version]'

const memcached = new ZanixMemcachedConnector({
  memcachedUri: Deno.env.get('MEMCACHED_URI'), // falls back to MEMCACHED_URI env var, then 'localhost:11211'
  ttl: 60, // seconds; 0 (default) = never expires
})

await memcached.isReady

await memcached.set('user:1', { name: 'Ada' })
const user = await memcached.get('user:1')
```

Uses the classic Memcached ASCII text protocol over a raw `Deno.connect` TCP socket — no external
client dependency. `MemcachedOptions` also accepts `connectionTimeout` (ms, used both for the
initial TCP connect and to bound how long a command waits for the connector to become ready, so a
command fails fast instead of sitting on the framework's own up-to-10s internal retry loop).

**Thinner than `ZanixRedisConnector` by design, not by omission**: no command retries (no
`execWithRetry`/`maxCommandRetries` equivalent), no per-command timeout once connected (only the
initial `connectionTimeout`), no pipelining (`schedule` is accepted but ignored, see below), and
reconnect is a single lazy attempt on the next command rather than a configurable background
`reconnectStrategy`. Treat this connector as a best-effort cache, not a Redis-equivalent guarantee.

**`clear()` flushes the _entire_ Memcached instance** (`flush_all`) — the same shared-instance
footgun `ZanixRedisConnector.clear()` already documents for Redis. Never call it against an instance
shared with anything else.

**`set(key, value, { exp: 'KEEPTTL' })` is not supported and throws**
(`MEMCACHED_KEEPTTL_UNSUPPORTED`): the classic protocol has no command to read a key's remaining
TTL, so there's no way to genuinely preserve it on overwrite — pass an explicit `exp` (seconds)
instead. `options.schedule` (a Redis-specific pipelining hint) is accepted but silently ignored —
every write is synchronous.

### `keys()`/`values()`/`size()`: a real protocol limitation, not a bug

Unlike Redis's `SCAN`/`DBSIZE`, the classic Memcached protocol has **no command that lists every key
or reports the item count**. The alternative some deployments expose,
`stats items`/`stats
cachedump`, is commonly disabled in production (it's an O(n) debugging tool
over the whole slab allocator, not a stable API) and is deliberately not used here.

Instead, `keys()`, `values()`, and `size()` are backed by a **per-connector-instance, in-memory
index** of the keys that exact instance has itself written via `set()`, pruned lazily on read (each
read confirms server-side existence, so expired/evicted entries drop out on their own). Concretely:

- A key set through a _different_ connector instance, a different process, or a raw client talking
  to the same Memcached server is **invisible** to these three methods on this instance.
- `size()`/`keys()`/`values()` are only ever a **lower bound** on what the server actually holds.

`get`/`set`/`has`/`delete`/`clear` all talk to the real server directly and don't have this
limitation — only treat `keys()`/`values()`/`size()` as an inventory of what this instance itself
wrote, never as an authoritative view of a shared Memcached instance.

## Local cache (`ZanixQLRUConnector`)

```ts
import { ZanixQLRUConnector } from 'jsr:@zanix/datamaster@[version]'

const local = new ZanixQLRUConnector({
  capacity: 1000, // falls back to LOCAL_CACHE_MAX_ITEMS env var, then 50000
  ttl: 30,
})
```

A synchronous, in-memory Least-Recently-Used cache — every read/write happens against a plain `Map`,
evicting the single oldest entry whenever the configured `capacity` is exceeded. `isHealthy()`
always returns `true` (there's no external connection to be unhealthy). `getClient()` returns the
raw underlying `Map` if you need direct access.

## Multi-layer cache provider (`ZanixCacheCoreProvider`)

```ts
import { ZanixCacheCoreProvider } from 'jsr:@zanix/datamaster@[version]'

class MyCacheProvider extends ZanixCacheCoreProvider {
  async getUser(id: string) {
    return this.getCachedOrFetch('redis', `user:${id}`, {
      fetcher: () => db.findUser(id),
    })
  }
}
```

`getCachedOrFetch`/`getCachedOrRevalidate`'s first argument is currently always the literal string
`'redis'` — it names which registered remote connector to fall back to; the local (QLRU) layer is
always consulted first via `this.local` and doesn't need to be named. `ZanixMemcachedConnector` is
not wired into this multi-layer provider today — use it directly (as shown above) rather than
through `getCachedOrFetch`/`getCachedOrRevalidate`.

- **`getCachedOrFetch(provider, key, { fetcher? })`** — checks local first; on a local miss, checks
  the remote provider and, if found, **writes the value back into local cache**; on a full miss,
  calls `fetcher()` (if given) and writes the fresh value to both caches. Returns `undefined` on a
  full miss with no `fetcher`.
- **`getCachedOrRevalidate(provider, key, { softTtl?, fetcher? })`** — a stale-while-revalidate
  strategy. The cached value must be stored as an envelope, `{ value, timestamp }` (you write it
  that way yourself). If the local entry's age is under `softTtl` (default `45` seconds), it's
  returned immediately with no remote check at all. If the remote entry is still fresh, it refreshes
  local and returns it. If the remote entry exists but is **older** than `softTtl`, the stale value
  is returned immediately and, only if a `fetcher` was given, a refresh runs in the background
  (errors there are only logged, never thrown to the original caller).

Both methods log and continue (rather than throwing) if the _remote_ read/write fails and a
`fetcher` is available — the local cache and the fetcher act as a fallback path.

### `withLock`

```ts
await provider.withLock(`user:${id}`, async () => {
  // only one call for this exact key runs at a time, on this provider instance
})
```

A thin delegate to an internal, per-instance keyed lock manager (single process, in-memory only, not
distributed across replicas): only one call for the same key runs at a time on this provider
instance; other keys run fully in parallel.

## Type-only Cache (Redis) contracts (`./cache/types`)

```ts
import type {
  ZanixRedisClientLike,
  ZanixRedisConnectorLike,
} from 'jsr:@zanix/datamaster@[version]/cache/types'

class MyService {
  constructor(private readonly cache: ZanixRedisConnectorLike<string>) {}
}
```

A consumer that only needs `ZanixRedisConnector`'s shape as a TYPE — a generic type parameter, a
constructor argument annotation — never the real class, imports from this subpath instead of
`./cache` or the root package. A plain
`import type { ZanixRedisConnector } from '@zanix/datamaster/cache'` still resolves that class's own
defining module to type-check it, and that module has a real, unconditional `redis` value import —
so even a type-only import pulls `redis` into a consumer's dependency graph.
`ZanixRedisConnectorLike`/`ZanixRedisClientLike` describe the same public surface structurally, with
zero import of `redis` (or `mongoose`/`@aws-sdk/client-s3`) anywhere in this subpath's own module
graph.

`ZanixRedisConnectorLike` covers
`set`/`get`/`has`/`delete`/`clear`/`size`/`keys`/`values`/`getClient`/
`isHealthy`/`isReady`/`ttl`/`maxOffsetSeconds`/`minTTLForOffset` — the same public surface
`ZanixRedisConnector` exposes. `ZanixRedisClientLike` mirrors the subset of the underlying Redis
client's own methods (`set`/`incr`/`sAdd`/`sRem`/`sMembers`/`eval`, plus
`connect`/`duplicate`/`subscribe`/`publish`/ `unsubscribe`/`close` for Pub/Sub and connection
management) that `getClient()`'s return type can be narrowed to, for code that needs to reach past
the connector for a raw command.

## See also

- [Configuration](./configuration.md) — `REDIS_URI`, `LOCAL_CACHE_MAX_ITEMS`.
