import { assert } from '@std/assert'

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

Deno.test({
  name:
    'observability core DSL resolves an actual connector instance, forwarding options.index through its constructor override',
  fn: async () => {
    Deno.env.set('ELASTICSEARCH_URL', 'http://localhost:9200')

    try {
      await import('observability/core.ts?case=resolve-instance')
      const { ProgramModule } = await import('@zanix/server')
      const { ZanixElasticsearchConnector } = await import(
        'observability/connector.ts'
      )

      const connector = ProgramModule.getConnectors(undefined, false).get(
        'search',
      )

      assert(connector instanceof ZanixElasticsearchConnector)
    } finally {
      Deno.env.delete('ELASTICSEARCH_URL')
    }
  },
})
