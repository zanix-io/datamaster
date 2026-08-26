import { assert } from '@std/assert'

/**
 * Structural guard rail: this package's own DLQ business logic (`modules/dlq/{dlq.provider,
 * dlq.service}.ts`) must never reach back INTO `modules/dlq/dlq-api/` — the local-api/HTTP layer
 * built ON TOP of it. The dependency is strictly one-way (`dlq-api` -> provider/service, never the
 * reverse), the same shape `src/@tests/unit/triggers/dependency-boundary.test.ts` already enforces
 * for `triggers-api` -> service/repository. Verified via `deno info --json`'s actual resolved
 * module graph — transitive reachability, not a grep over `deno.json`'s own `imports` map.
 *
 * This does NOT assert "never reaches `@zanix/server`" — this package's own provider/service layer
 * legitimately imports `@zanix/server` (`Provider`/`Interactor`) for DI, same as every other
 * provider/interactor in this package. The boundary that matters here is direction, not presence.
 *
 * Also guards `@zanix/datamaster/dlq`'s own entry file (`modules/dlq/mod.ts`) — the narrow subpath
 * a consumer that only needs `DlqProvider` imports instead of this package's root `.` — never
 * resolves anything under `modules/cache/`. Reaching Mongo (`modules/database/`) is expected: the
 * DLQ collection is Mongo-backed. This is the local half of that subpath's own isolation guarantee;
 * whether the `redis`/`@redis/*`/`graphql` npm packages themselves stay out of a real consumer's
 * own `node_modules` also depends on `@zanix/server`'s own currently-pinned version (see
 * `docs/dlq.md`) — a separate, cross-package guarantee this local-graph check can't observe on its
 * own, so it's checked here too, directly against `@zanix/server`'s real resolved dependency graph
 * (not this package's own source tree).
 *
 * @module
 */

const ENTRY_PROVIDER = 'src/modules/dlq/dlq.provider.ts'
const ENTRY_SERVICE = 'src/modules/dlq/dlq.service.ts'
const ENTRY_MOD = 'src/modules/dlq/mod.ts'

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

function includesLocalPathSegment(specifiers: Set<string>, segment: string): boolean {
  return [...specifiers].some((specifier) => specifier.includes(segment))
}

/** Matches a resolved `npm:` specifier for `packageName`, tolerating the `npm:/pkg@version` and
 * `npm:pkg@version` shapes `deno info --json` uses across scoped/unscoped packages. */
function includesNpmPackage(specifiers: Set<string>, packageName: string): boolean {
  return [...specifiers].some((specifier) =>
    specifier.startsWith(`npm:/${packageName}@`) || specifier.startsWith(`npm:${packageName}@`)
  )
}

for (const entry of [ENTRY_PROVIDER, ENTRY_SERVICE]) {
  Deno.test(
    `${entry}: never reaches back into modules/dlq/dlq-api/ (the local-api layer built ON TOP ` +
      'of this business logic) — the dependency is strictly one-way',
    async () => {
      const graph = await moduleGraph(entry)
      assert(
        !includesLocalPathSegment(graph.code, '/modules/dlq/dlq-api/'),
        `${entry} must never resolve a module under modules/dlq/dlq-api/ as code`,
      )
      assert(
        !includesLocalPathSegment(graph.type, '/modules/dlq/dlq-api/'),
        `${entry} must never resolve a module under modules/dlq/dlq-api/ as a type`,
      )
    },
  )
}

Deno.test(
  `${ENTRY_MOD}: the narrow @zanix/datamaster/dlq subpath never resolves a module under ` +
    'modules/cache/ (the Redis/Memcached stack) — reaching modules/database/ is expected, since ' +
    'the DLQ collection is Mongo-backed',
  async () => {
    const graph = await moduleGraph(ENTRY_MOD)
    assert(
      !includesLocalPathSegment(graph.code, '/modules/cache/'),
      `${ENTRY_MOD} must never resolve a module under modules/cache/ as code`,
    )
    assert(
      !includesLocalPathSegment(graph.type, '/modules/cache/'),
      `${ENTRY_MOD} must never resolve a module under modules/cache/ as a type`,
    )
  },
)

Deno.test(
  `${ENTRY_MOD}: never resolves the redis/@redis/* or graphql npm packages — a cross-package ` +
    "guarantee that additionally depends on @zanix/server's own currently-pinned version (see " +
    'docs/dlq.md)',
  async () => {
    const graph = await moduleGraph(ENTRY_MOD)
    const npmPackages = [
      'redis',
      '@redis/client',
      '@redis/bloom',
      '@redis/json',
      '@redis/search',
      '@redis/time-series',
      'graphql',
    ]
    for (const pkg of npmPackages) {
      assert(
        !includesNpmPackage(graph.code, pkg),
        `${ENTRY_MOD} must never resolve npm:${pkg} as code`,
      )
      assert(
        !includesNpmPackage(graph.type, pkg),
        `${ENTRY_MOD} must never resolve npm:${pkg} as a type`,
      )
    }
  },
)
