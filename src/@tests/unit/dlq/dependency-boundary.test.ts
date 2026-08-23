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
 * @module
 */

const ENTRY_PROVIDER = 'src/modules/dlq/dlq.provider.ts'
const ENTRY_SERVICE = 'src/modules/dlq/dlq.service.ts'

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
