import { assert, assertRejects } from '@std/assert'
import { S3ObjectStorage } from 'storage/connector.ts'

/**
 * `S3ObjectStorage`'s "is this object actually missing, or did something else fail?"
 * classification (`isNotFound()`, `connector.ts`), proven against REAL `@aws-sdk/client-s3`
 * responses — a real local HTTP server returning genuine S3-style XML error bodies, not a hand-
 * stubbed `S3Client.prototype.send`. `isNotFound()` is a strict ALLOWLIST (only `NoSuchKey`/
 * `NotFound` are treated as "doesn't exist"), so every one of these — confirmed via direct probing
 * against the real SDK before writing this file — has to produce a DIFFERENT `error.name` for the
 * allowlist to be safe:
 *
 *   - connection refused        -> name: 'Error', code: 'ECONNREFUSED'
 *   - malformed endpoint config -> name: 'TypeError' (thrown at request-construction time)
 *   - AccessDenied (403)        -> name: 'AccessDenied'
 *   - InvalidAccessKeyId (403, via HeadObject) -> name: 'Unknown' (S3ServiceException)
 *   - InternalError (500)       -> name: 'InternalError'
 *   - SlowDown (503)            -> name: 'SlowDown'
 *
 * None of these collide with `NoSuchKey`/`NotFound` — this file proves `get()`/`exists()` actually
 * throw for each, rather than trusting that claim from reading the allowlist alone.
 */

/** A real local server returning genuine S3-style XML error bodies for whichever `code` is
 * currently configured — swapped between assertions via `setMode`, so one server serves every
 * scenario in this file. */
function startFakeS3Server() {
  let mode: { code: string; message: string; status: number } = {
    code: 'AccessDenied',
    message: 'Access Denied',
    status: 403,
  }
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${mode.code}</Code>` +
      `<Message>${mode.message}</Message><RequestId>test</RequestId></Error>`
    return new Response(body, {
      status: mode.status,
      headers: { 'Content-Type': 'application/xml' },
    })
  })
  const addr = server.addr as Deno.NetAddr
  return {
    endpoint: `http://127.0.0.1:${addr.port}`,
    setMode: (code: string, message: string, status: number) => {
      mode = { code, message, status }
    },
    shutdown: () => server.shutdown(),
  }
}

Deno.test(
  'S3ObjectStorage.get propagates a REAL AccessDenied (403), never treats it as missing',
  async () => {
    const fake = startFakeS3Server()
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: fake.endpoint,
      })
      await assertRejects(() => storage.get('a'), Error, 'Access Denied')
    } finally {
      await fake.shutdown()
    }
  },
)

Deno.test(
  'S3ObjectStorage.exists propagates a REAL InvalidAccessKeyId (403), never treats it ' +
    'as missing',
  async () => {
    const fake = startFakeS3Server()
    fake.setMode('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist', 403)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: fake.endpoint,
      })
      // Genuinely asserts the call REJECTS (not "resolves to false") — an auth failure must never
      // be reported the same way as a real absent object.
      await assertRejects(() => storage.exists('a'))
    } finally {
      await fake.shutdown()
    }
  },
)

Deno.test(
  'S3ObjectStorage.get propagates a REAL InternalError (500), never treats it as missing',
  async () => {
    const fake = startFakeS3Server()
    fake.setMode('InternalError', 'We encountered an internal error', 500)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: fake.endpoint,
      })
      await assertRejects(() => storage.get('a'), Error, 'internal error')
    } finally {
      await fake.shutdown()
    }
  },
)

Deno.test(
  'S3ObjectStorage.exists propagates a REAL SlowDown (503), never treats it as missing',
  async () => {
    const fake = startFakeS3Server()
    fake.setMode('SlowDown', 'Please reduce your request rate', 503)
    try {
      const storage = new S3ObjectStorage({
        autoInitialize: false,
        endpoint: fake.endpoint,
      })
      await assertRejects(() => storage.exists('a'))
    } finally {
      await fake.shutdown()
    }
  },
)

Deno.test(
  'S3ObjectStorage.get propagates a REAL connection-refused error, never treats it as missing',
  async () => {
    // Port 1 — real OS-level ECONNREFUSED, no fake server needed (nothing can ever listen there).
    const storage = new S3ObjectStorage({
      autoInitialize: false,
      endpoint: 'http://127.0.0.1:1',
    })
    const error = await assertRejects(() => storage.get('a'))
    assert(
      (error as { code?: string }).code === 'ECONNREFUSED',
      `expected a real ECONNREFUSED, got: ${(error as Error).message}`,
    )
  },
)

Deno.test(
  'S3ObjectStorage.exists propagates a REAL connection-refused error, never treats it as missing',
  async () => {
    const storage = new S3ObjectStorage({
      autoInitialize: false,
      endpoint: 'http://127.0.0.1:1',
    })
    const error = await assertRejects(() => storage.exists('a'))
    assert((error as { code?: string }).code === 'ECONNREFUSED')
  },
)

Deno.test(
  'S3ObjectStorage.get: a malformed endpoint genuinely rejects get(), never resolves undefined',
  async () => {
    // Confirmed via direct probing: `@aws-sdk/client-s3` doesn't parse/validate `endpoint` at
    // construction time — it throws a real `TypeError` ("Invalid URL") the first time a request
    // is actually attempted, which is exactly what this asserts.
    const storage = new S3ObjectStorage({
      autoInitialize: false,
      endpoint: 'not-a-valid-url',
    })
    await assertRejects(() => storage.get('a'), TypeError)
  },
)
