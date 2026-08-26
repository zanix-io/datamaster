import { assert } from '@std/assert'

/**
 * Structural guard rail: `@zanix/datamaster/database`'s own entry file (`modules/database/mod.ts`)
 * never resolves the `redis`/`@redis/*` or `graphql` npm packages — a cross-package guarantee that
 * additionally depends on `@zanix/server`'s own currently-pinned version, since every
 * provider/interactor/connector here resolves DI primitives through `@zanix/server`'s bare root.
 * Verified via `deno info --json`'s actual resolved dependency graph, the same technique
 * `src/@tests/unit/dlq/dependency-boundary.test.ts` uses for its own equivalent guard.
 *
 * This does NOT assert "never reaches `@zanix/server`" — this subpath legitimately imports
 * `@zanix/server` (`Connector`/`ProgramModule`) for DI. The boundary that matters here is which
 * heavy npm packages become reachable through it, not whether `@zanix/server` itself is present.
 *
 * @module
 */

const ENTRY_MOD = 'src/modules/database/mod.ts'

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
  `${ENTRY_MOD}: never resolves the redis/@redis/* or graphql npm packages — only mongoose is a ` +
    "real dependency here, and this additionally depends on @zanix/server's own currently-pinned " +
    'version',
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
