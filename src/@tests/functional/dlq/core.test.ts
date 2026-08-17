import { assert, assertStrictEquals } from '@std/assert'

Deno.test({
  name: 'dlq core DSL registers DLQProvider under the dlq core-provider slot, aliased both ways',
  fn: async () => {
    await import('dlq/core.ts')
    const { ProgramModule } = await import('@zanix/server')
    const { DLQProvider } = await import('dlq/dlq.provider.ts')

    const byKey = ProgramModule.getProviders(undefined, false).get('dlq')
    const byClass = ProgramModule.getProviders(undefined, false).get(
      DLQProvider,
    )

    assert(byKey instanceof DLQProvider)
    assertStrictEquals(byKey, byClass)
  },
})
