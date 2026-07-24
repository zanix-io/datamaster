Deno.test('sqlite core DSL registers the default KV connector on import', async () => {
  await import('sqlite/core.ts')
})
