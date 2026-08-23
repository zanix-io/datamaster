import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { S3ObjectStorage } from 'storage/connector.ts'
import { S3Client } from '@aws-sdk/client-s3'

/**
 * Empirical evidence for the claim (documented in `connector.ts`'s own class doc and repeated in
 * `datamaster-connector-registration`/`datamaster-storage`) that `S3ObjectStorage` is a genuinely
 * generic `@aws-sdk/client-s3` client — configuring it for a DIFFERENT S3-compatible backend than
 * SeaweedFS (the backend its defaults are named after) is a plain constructor-option change, never a
 * new class. This doesn't construct a new backend implementation — it inspects the REAL `S3Client`
 * this connector builds internally (via `client.config`, not `command.input`, since endpoint/region/
 * credentials are client-level config, not per-request input) to confirm it actually resolves to
 * whatever backend was configured, rather than silently falling back to SeaweedFS's own defaults
 * (`http://localhost:8333`, `DUMMY_REGION`) no matter what options are passed.
 *
 * `S3Client.prototype.send` is stubbed with a plain `function` (not an arrow function) specifically
 * so `this` inside it is the real call-site `this` — the `S3Client` instance `this.#client.send(...)`
 * invokes it on — giving access to `this.config.region()`/`this.config.endpoint()`/
 * `this.config.credentials()`, the SDK's own resolved (and awaitable) client configuration, verified
 * empirically against a live `S3Client` (see this test file's own dev history) before relying on it
 * here.
 */

const originalSend = S3Client.prototype.send

function restoreSend(): void {
  S3Client.prototype.send = originalSend
}

Deno.test(
  'S3ObjectStorage: constructing it for a backend with real AWS-shaped options (a real ' +
    "region-carrying endpoint, distinct credentials, distinct bucket — none of them SeaweedFS's " +
    'own defaults) produces a REAL S3Client resolved to THAT backend, not silently defaulted',
  async () => {
    let capturedConfig: {
      endpoint: () => Promise<{ hostname: string; protocol: string }>
      credentials: () => Promise<{ accessKeyId: string; secretAccessKey: string }>
    } | undefined

    // Plain `function`, not an arrow — `this` must be the real call-site `this.#client` instance
    // (see this file's own top doc) for `this.config` to be reachable at all.
    S3Client.prototype.send = function (
      this: { config: typeof capturedConfig },
    ) {
      capturedConfig = this.config
      return Promise.resolve({})
    } as typeof S3Client.prototype.send

    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        // A real AWS-region-carrying endpoint — genuinely different shape from SeaweedFS's own
        // `http://localhost:8333` default (no port, real hostname, https).
        endpoint: 'https://s3.eu-west-1.amazonaws.com',
        bucket: 'a-real-aws-bucket',
        accessKeyId: 'AKIA_REAL_LOOKING_KEY',
        secretAccessKey: 'a-real-looking-secret',
      })

      await storage.isHealthy()

      assert(capturedConfig, 'expected S3Client.send to have been called with a real client `this`')
      const endpoint = await capturedConfig.endpoint()
      const credentials = await capturedConfig.credentials()

      assertEquals(endpoint.hostname, 's3.eu-west-1.amazonaws.com')
      assertEquals(endpoint.protocol, 'https:')
      assertNotEquals(
        endpoint.hostname,
        'localhost',
        'expected the configured endpoint to win — never silently falling back to the ' +
          "SeaweedFS-shaped 'http://localhost:8333' default",
      )
      assertEquals(credentials.accessKeyId, 'AKIA_REAL_LOOKING_KEY')
      assertEquals(credentials.secretAccessKey, 'a-real-looking-secret')
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage: the bucket in every command it sends is the one actually configured for ' +
    "this instance, never SeaweedFS's own default bucket",
  async () => {
    let sentBucket: string | undefined
    S3Client.prototype.send = ((command: { input: { Bucket?: string } }) => {
      sentBucket = command.input.Bucket
      return Promise.resolve({})
    }) as typeof S3Client.prototype.send

    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: 'https://s3.ap-southeast-2.amazonaws.com',
        bucket: 'a-totally-different-bucket',
      })
      await storage.isHealthy()
      assertEquals(sentBucket, 'a-totally-different-bucket')
      assertNotEquals(
        sentBucket,
        'zanix-objects',
        'expected the real bucket, not the built-in default',
      )
    } finally {
      restoreSend()
    }
  },
)

// --- The real gap this same evidence originally surfaced (`region` had NO constructor option —
// every S3Client silently signed under the hardcoded `DUMMY_REGION` regardless of the configured
// endpoint) is now fixed: `region` is a real, overridable `S3ConnectorOptions` field, falling back
// to `S3_REGION` then `DUMMY_REGION` — same precedence shape as `endpoint`/`bucket`/credentials.
// Both directions covered below: still-defaults-when-omitted (the harmless case, unchanged), and
// genuinely-overridable-when-passed (the fix). --------------------------------------------------

Deno.test(
  'S3ObjectStorage: region still defaults to DUMMY_REGION when omitted (harmless for a ' +
    "self-hosted gateway that doesn't validate it) — omitting `region` is not itself the bug; " +
    'having no way to override it was',
  async () => {
    let capturedRegion: (() => Promise<string>) | undefined
    S3Client.prototype.send = function (
      this: { config: { region: () => Promise<string> } },
    ) {
      capturedRegion = this.config.region
      return Promise.resolve({})
    } as typeof S3Client.prototype.send

    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: 'https://s3.eu-west-1.amazonaws.com',
        bucket: 'test',
      })
      await storage.isHealthy()

      assert(capturedRegion, 'expected S3Client.send to have been called with a real client `this`')
      assertEquals(
        await capturedRegion(),
        'us-east-1',
        'expected the default DUMMY_REGION when no region was configured at all — this default is ' +
          'intentional, not the gap; see the next test for the actual fix',
      )
    } finally {
      restoreSend()
    }
  },
)

Deno.test(
  'S3ObjectStorage: an explicit `region` option is genuinely signed into the real S3Client — ' +
    'the fix for the gap the previous test documents as intentional-default-only',
  async () => {
    let capturedRegion: (() => Promise<string>) | undefined
    S3Client.prototype.send = function (
      this: { config: { region: () => Promise<string> } },
    ) {
      capturedRegion = this.config.region
      return Promise.resolve({})
    } as typeof S3Client.prototype.send

    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: 'https://s3.eu-west-1.amazonaws.com',
        bucket: 'test',
        region: 'eu-west-1',
      })
      await storage.isHealthy()

      assert(capturedRegion, 'expected S3Client.send to have been called with a real client `this`')
      assertEquals(
        await capturedRegion(),
        'eu-west-1',
        'expected the explicitly configured region to win — this connector can now sign requests ' +
          'correctly for a real, non-us-east-1 AWS S3 bucket',
      )
    } finally {
      restoreSend()
    }
  },
)
