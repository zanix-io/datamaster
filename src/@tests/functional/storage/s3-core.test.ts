import { assert } from '@std/assert'

const clearEnv = () => {
  Deno.env.delete('S3_ENDPOINT')
}

Deno.test({
  name: 'storage core DSL skips connector registration when S3_ENDPOINT is unset',
  fn: async () => {
    clearEnv()

    await import('storage/core.ts?case=no-endpoint')
  },
})

Deno.test({
  name: 'storage core DSL registers the default connector when S3_ENDPOINT is set',
  fn: async () => {
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')

    try {
      await import('storage/core.ts?case=with-endpoint')
    } finally {
      clearEnv()
    }
  },
})

Deno.test({
  name:
    "storage core DSL resolves an actual connector instance under the shared 's3' core-connector slot",
  fn: async () => {
    Deno.env.set('S3_ENDPOINT', 'http://localhost:8333')

    try {
      await import('storage/core.ts?case=resolve-instance')
      const { ProgramModule } = await import('@zanix/server')
      const { S3ObjectStorage } = await import('storage/connector.ts')

      const connector = ProgramModule.getConnectors(undefined, false).get('s3')

      assert(connector instanceof S3ObjectStorage)
    } finally {
      clearEnv()
    }
  },
})
