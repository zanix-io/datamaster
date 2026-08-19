import { assert, assertEquals } from '@std/assert'
import { SeaweedFSObjectStorage } from 'storage/connector.ts'

/**
 * Exercises `SeaweedFSObjectStorage` against a REAL local SeaweedFS instance — same
 * enabled-by-env-flag convention every other real-service suite in this package uses
 * (`RUN_OPENSEARCH_TESTS`, see `src/@tests/functional/observability/connector-real.test.ts`).
 *
 * Deliberately gated on the flag ALONE, never on whether the service is actually reachable: if
 * `RUN_SEAWEEDFS_TESTS=true` is set but no SeaweedFS is listening, this test runs for real and
 * genuinely fails — it never silently downgrades to skipped. That's what makes `ignore` here mean
 * "integration testing wasn't opted into," not "the environment happened to be unavailable."
 *
 * 1. Start a local SeaweedFS with the S3 gateway enabled:
 *
 *      docker run -d --name zanix-seaweedfs-test \
 *        -p 8333:8333 \
 *        chrislusf/seaweedfs server -s3
 *
 * 2. Set `RUN_SEAWEEDFS_TESTS=true` (see `.env.test.example`) and, if not using the defaults,
 *    `SEAWEEDFS_S3_ENDPOINT`/`SEAWEEDFS_ACCESS_KEY`/`SEAWEEDFS_SECRET_KEY`/`SEAWEEDFS_BUCKET`.
 * 3. Run: `deno test --allow-all src/@tests/functional/storage/`
 *
 * See `docs/STORAGE.md#testing-against-a-real-local-seaweedfs` for more.
 */
const shouldRun = Deno.env.get('RUN_SEAWEEDFS_TESTS') === 'true'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !shouldRun,
  name:
    'SeaweedFSObjectStorage full put/get/exists/delete lifecycle against a real SeaweedFS instance',
  fn: async () => {
    const storage = new SeaweedFSObjectStorage({ autoInitialize: false })
    const key = `objects/functional-test-${crypto.randomUUID()}/original`

    try {
      assertEquals(await storage.isHealthy(), true, 'expected a real, reachable SeaweedFS bucket')
      assertEquals(await storage.exists(key), false)

      const bytes = new TextEncoder().encode('real seaweedfs round-trip')
      const put = await storage.put(key, bytes, { contentType: 'text/plain' })
      assertEquals(put.key, key)
      assertEquals(put.size, bytes.byteLength)

      assertEquals(await storage.exists(key), true)

      const fetched = await storage.get(key)
      assert(fetched, 'expected the object just written to be found')
      assertEquals(fetched.object.checksum, put.checksum)
      const streamed = new Uint8Array(await new Response(fetched.stream).arrayBuffer())
      assertEquals(streamed, bytes)

      await storage.delete(key)
      assertEquals(await storage.exists(key), false)
      // Deleting again is a no-op, never an error.
      await storage.delete(key)
    } finally {
      await storage.get(key).then((found) => found && storage.delete(key))
    }
  },
})
