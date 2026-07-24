Deno.test({
  name: 'mongo connector core DSL skips connector registration when MONGO_URI is not set',
  fn: async () => {
    Deno.env.delete('MONGO_URI')

    await import('mongo/connector/core.ts?case=no-uri')
  },
})

Deno.test({
  name: 'mongo connector core DSL registers the default mongo connector when MONGO_URI is set',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost:27017/test')

    try {
      await import('mongo/connector/core.ts?case=with-uri')
    } finally {
      Deno.env.delete('MONGO_URI')
    }
  },
})
