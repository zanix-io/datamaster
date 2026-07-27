Deno.test({
  name: 'observability core DSL skips connector registration when no cluster URL is set',
  fn: async () => {
    Deno.env.delete('ELASTICSEARCH_URL')
    Deno.env.delete('OPENSEARCH_URL')

    await import('observability/core.ts?case=no-url')
  },
})

Deno.test({
  name: 'observability core DSL registers the default connector when ELASTICSEARCH_URL is set',
  fn: async () => {
    Deno.env.set('ELASTICSEARCH_URL', 'http://localhost:9200')

    try {
      await import('observability/core.ts?case=with-elasticsearch-url')
    } finally {
      Deno.env.delete('ELASTICSEARCH_URL')
    }
  },
})

Deno.test({
  name: 'observability core DSL registers the default connector when OPENSEARCH_URL is set',
  fn: async () => {
    Deno.env.set('OPENSEARCH_URL', 'http://localhost:9200')

    try {
      await import('observability/core.ts?case=with-opensearch-url')
    } finally {
      Deno.env.delete('OPENSEARCH_URL')
    }
  },
})
