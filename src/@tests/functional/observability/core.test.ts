import { assert } from '@std/assert'

const clearEnv = () => {
  Deno.env.delete('SEARCH_ENGINE')
  Deno.env.delete('SEARCH_URL')
}

Deno.test({
  name: 'observability core DSL skips connector registration when SEARCH_ENGINE is unset',
  fn: async () => {
    clearEnv()

    await import('observability/core.ts?case=no-engine')
  },
})

Deno.test({
  name: 'observability core DSL registers the default connector when SEARCH_ENGINE=elasticsearch',
  fn: async () => {
    Deno.env.set('SEARCH_ENGINE', 'elasticsearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')

    try {
      await import('observability/core.ts?case=with-elasticsearch-engine')
    } finally {
      clearEnv()
    }
  },
})

Deno.test({
  name: 'observability core DSL registers the default connector when SEARCH_ENGINE=opensearch',
  fn: async () => {
    Deno.env.set('SEARCH_ENGINE', 'opensearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')

    try {
      await import('observability/core.ts?case=with-opensearch-engine')
    } finally {
      clearEnv()
    }
  },
})

Deno.test({
  name:
    'observability core DSL resolves an actual connector instance, forwarding options.index through its constructor override',
  fn: async () => {
    Deno.env.set('SEARCH_ENGINE', 'elasticsearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')

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
      clearEnv()
    }
  },
})
