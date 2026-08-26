import { assert } from '@std/assert'

/**
 * Structural guard rail: `@zanix/datamaster/core`'s own entry file (`modules/core.ts`) — the
 * zero-config barrel that also re-exports `storage/core.ts` — must never resolve
 * `@aws-sdk/client-s3`. `storage/core.ts`'s own `registerS3Connector()` only imports
 * `./connector.ts` (the file that actually pulls that npm package in) lazily, INSIDE an async
 * function body gated on `Deno.env.has('S3_ENDPOINT')`, via a non-literal dynamic `import()`
 * specifier — so a consumer of `/core` that never sets `S3_ENDPOINT` never resolves that import at
 * all, statically or dynamically. Verified via `deno info --json`'s actual resolved dependency
 * graph, the same technique `src/@tests/unit/database/dependency-boundary.test.ts` and
 * `src/@tests/unit/dlq/dependency-boundary.test.ts` use for their own equivalent guards.
 *
 * This does NOT assert `/core` never needs `mongoose`/`redis` — those ARE expected, unavoidable
 * dependencies of `/core`'s own Mongo/cache wiring (unlike S3 storage, which is a much rarer,
 * opt-in capability gated entirely behind `S3_ENDPOINT` being set at all). This also does NOT
 * assert `@zanix/datamaster/storage` (the standalone subpath a consumer explicitly wanting S3
 * storage imports directly) avoids `@aws-sdk/client-s3` — it legitimately, and unconditionally,
 * needs it; that subpath's own isolation from this guard is asserted below as a contrast.
 *
 * @module
 */

const ENTRY_CORE = 'src/modules/core.ts'
const ENTRY_STORAGE_CORE = 'src/modules/storage/core.ts'
const ENTRY_STORAGE_MOD = 'src/modules/storage/mod.ts'

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

for (const entry of [ENTRY_CORE, ENTRY_STORAGE_CORE]) {
  Deno.test(
    `${entry}: never resolves the @aws-sdk/client-s3 npm package — a consumer that never sets ` +
      'S3_ENDPOINT must not pay for it, even though mongoose/redis (unrelated, always-relevant ' +
      "connectors this zero-config barrel also wires up) legitimately do reach this entry's graph",
    async () => {
      const graph = await moduleGraph(entry)
      assert(
        !includesNpmPackage(graph.code, '@aws-sdk/client-s3'),
        `${entry} must never resolve npm:@aws-sdk/client-s3 as code`,
      )
      assert(
        !includesNpmPackage(graph.type, '@aws-sdk/client-s3'),
        `${entry} must never resolve npm:@aws-sdk/client-s3 as a type`,
      )
    },
  )
}

Deno.test(
  `${ENTRY_STORAGE_MOD}: the standalone @zanix/datamaster/storage subpath still resolves ` +
    '@aws-sdk/client-s3 unconditionally, unaffected by /core needing it lazily — a direct consumer ' +
    'of S3ObjectStorage sees zero behavior change',
  async () => {
    const graph = await moduleGraph(ENTRY_STORAGE_MOD)
    assert(
      includesNpmPackage(graph.code, '@aws-sdk/client-s3'),
      `${ENTRY_STORAGE_MOD} must still resolve npm:@aws-sdk/client-s3 as code`,
    )
  },
)
