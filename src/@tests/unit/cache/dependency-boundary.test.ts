import { assert } from '@std/assert'
import type { ZanixRedisConnector } from 'cache/providers/redis/connector/mod.ts'
import type { ZanixRedisConnectorLike } from 'cache/typings/mod.ts'

/**
 * Structural guard rail: `@zanix/datamaster/cache/types`'s own entry file
 * (`modules/cache/typings/mod.ts`) never resolves the `redis`/`@redis/*`, `mongoose`, or
 * `@aws-sdk/client-s3` npm packages. This subpath exists specifically for a consumer that only
 * needs `ZanixRedisConnectorLike`/`ZanixRedisClientLike` as a TYPE (e.g. a generic type parameter),
 * never the real `ZanixRedisConnector` class — an `import type` of the real class's own defining
 * module still forces Deno to resolve that module's real value imports, `redis` included, so this
 * subpath's whole reason to exist is staying on the type-only side of `@zanix/server`'s abstract
 * connector classes instead. Verified via `deno info --json`'s actual resolved dependency graph,
 * the same technique `src/@tests/unit/dlq/dependency-boundary.test.ts` uses for its own equivalent
 * guard.
 *
 * This does NOT assert `/cache` (the real connector subpath) avoids `redis` — it legitimately,
 * unconditionally needs it. `/cache/types` is the separate, narrower entry point for a consumer
 * that wants none of that.
 *
 * @module
 */

const ENTRY_CACHE_TYPES = 'src/modules/cache/typings/mod.ts'

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

async function moduleGraph(entry: string): Promise<ModuleGraph> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }

  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const code = new Set<string>()
  const type = new Set<string>()
  for (const module of parsed.modules ?? []) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
  }
  return { code, type }
}

/** Matches a resolved `npm:` specifier for `packageName`, tolerating the `npm:/pkg@version` and
 * `npm:pkg@version` shapes `deno info --json` uses across scoped/unscoped packages. */
function includesNpmPackage(specifiers: Set<string>, packageName: string): boolean {
  return [...specifiers].some((specifier) =>
    specifier.startsWith(`npm:/${packageName}@`) || specifier.startsWith(`npm:${packageName}@`)
  )
}

Deno.test(
  `${ENTRY_CACHE_TYPES}: never resolves the redis/@redis/*, mongoose, or @aws-sdk/client-s3 npm ` +
    'packages, either as code or as a type',
  async () => {
    const graph = await moduleGraph(ENTRY_CACHE_TYPES)
    const npmPackages = [
      'redis',
      '@redis/client',
      '@redis/bloom',
      '@redis/json',
      '@redis/search',
      '@redis/time-series',
      'mongoose',
      '@aws-sdk/client-s3',
    ]
    for (const pkg of npmPackages) {
      assert(
        !includesNpmPackage(graph.code, pkg),
        `${ENTRY_CACHE_TYPES} must never resolve npm:${pkg} as code`,
      )
      assert(
        !includesNpmPackage(graph.type, pkg),
        `${ENTRY_CACHE_TYPES} must never resolve npm:${pkg} as a type`,
      )
    }
  },
)

/**
 * Compile-time-only drift guard: a real `ZanixRedisConnector` instance must stay structurally
 * assignable to `ZanixRedisConnectorLike`. `ZanixRedisConnectorLike` describes the real
 * connector's public surface without importing its defining module (which would drag in `redis`
 * as a real value import) — it does so by extending `@zanix/server`'s own abstract
 * `ZanixCacheConnector` class instead of hand-mirroring each method. That's only safe as long as
 * `ZanixRedisConnector`'s real public surface never grows a member outside what
 * `ZanixCacheConnector` already declares; this assignment fails to compile the moment it does,
 * catching the drift before a consumer relying on `ZanixRedisConnectorLike` silently loses type
 * accuracy. Nothing here runs at runtime — the assertion is `never` reached, since the check is
 * the TypeScript compiler accepting or rejecting the assignment itself.
 */
Deno.test('ZanixRedisConnector stays structurally assignable to ZanixRedisConnectorLike', () => {
  const real = null as unknown as ZanixRedisConnector<string, unknown>
  const like: ZanixRedisConnectorLike<string> = real
  assert(like === null)
})
