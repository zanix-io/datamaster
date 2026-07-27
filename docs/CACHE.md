# Cache

Local (in-memory) and Redis-backed caching, plus the multi-layer cache provider that combines both.

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
always consulted first via `this.local` and doesn't need to be named.

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

## See also

- [Configuration](./CONFIGURATION.md) — `REDIS_URI`, `LOCAL_CACHE_MAX_ITEMS`.
