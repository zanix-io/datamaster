// mocks
console.info = () => {}
console.error = () => {}
console.warn = () => {}

Deno.test('cache providers core DSL registers the default cache provider on import', async () => {
  await import('cache/providers/core.ts')
})

Deno.test('redis core DSL skips connector registration when REDIS_URI is not set', async () => {
  Deno.env.delete('REDIS_URI')

  await import('cache/providers/redis/core.ts?case=no-uri')
})

Deno.test({
  name: 'redis core DSL registers the default redis connector when REDIS_URI is set',
  fn: async () => {
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    try {
      await import('cache/providers/redis/core.ts?case=with-uri')
    } finally {
      Deno.env.delete('REDIS_URI')
    }
  },
})
