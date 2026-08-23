// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { Mongoose } from 'mongoose'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}

Deno.test('initialize logs and re-throws an InternalError when connect() rejects', async () => {
  const originalConnect = Mongoose.prototype.connect
  Mongoose.prototype.connect = () => Promise.reject(new Error('connection refused'))

  try {
    const db = new ZanixMongoConnector({ seedModel: false }) as any

    const error = await assertRejects(
      () => db['initialize'](),
      InternalError,
    )
    assertEquals(error.code, 'MONGODB_CONNECTOR_MONGO_ERROR')
  } finally {
    Mongoose.prototype.connect = originalConnect
  }
})

Deno.test('isHealthy returns false when the connection was never established', async () => {
  const db = new ZanixMongoConnector({ seedModel: false }) as any

  const healthy = await db.isHealthy()

  assertEquals(healthy, false)
})

Deno.test('isHealthy returns false when the ping command throws', async () => {
  const originalConnect = Mongoose.prototype.connect
  Mongoose.prototype.connect = async function (
    this: Mongoose,
    uri: string,
    options: unknown,
  ) {
    const result = await originalConnect.call(this, uri, options as never)
    const db = this.connection.db as NonNullable<typeof this.connection.db>
    db.command = () => Promise.reject(new Error('ping failed'))
    return result
  }

  const db = new ZanixMongoConnector({ seedModel: false }) as any

  try {
    await db['initialize']()
    const healthy = await db.isHealthy()
    assertEquals(healthy, false)
  } finally {
    Mongoose.prototype.connect = originalConnect
    await db['close']()
  }
})

Deno.test('initialize sanitizes a credential-bearing URI, logged exactly once', async () => {
  const db = new ZanixMongoConnector({ seedModel: false }) as any
  // Let the instance's own auto-init (`ZanixConnector`, `@zanix/server`) succeed first, against the
  // real local test MongoDB — otherwise it would race the manual `initialize()` call below with a
  // second, independent failing attempt of its own, each logging separately, and inflate the call
  // count checked below for reasons unrelated to what this test actually verifies.
  await db.isReady

  const originalConnect = Mongoose.prototype.connect
  const credentialBearingMessage =
    'Invalid connection string "mongodb://admin:S3cr3t@cluster0.mongodb.net/db"'
  Mongoose.prototype.connect = () => Promise.reject(new Error(credentialBearingMessage))

  const logged: unknown[] = []
  let callCount = 0
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    callCount++
    logged.push(...args)
  }

  try {
    await assertRejects(() => db['initialize'](), InternalError)
  } finally {
    Mongoose.prototype.connect = originalConnect
    console.error = originalError
    await db['close']()
  }

  const output = logged.map((entry) => Deno.inspect(entry)).join(' ')
  assertEquals(output.includes('S3cr3t'), false)
  assertEquals(output.includes('[REDACTED]'), true)

  // The `InternalError` self-logs once (`shouldLog: true`) — there must be no separate manual
  // `logger.error` call alongside it, or this failure would be logged twice (the known
  // double-log pitfall this same package hit before in `utils/protection.ts`/`seeders.ts`).
  assertEquals(callCount, 1)
})

Deno.test('close logs an error and does not throw when disconnect() rejects', async () => {
  const db = new ZanixMongoConnector({ seedModel: false }) as any
  await db['initialize']()

  const originalDisconnect = Mongoose.prototype.disconnect
  Mongoose.prototype.disconnect = () => Promise.reject(new Error('disconnect failed'))

  try {
    await db['close']()
  } finally {
    Mongoose.prototype.disconnect = originalDisconnect
    await db['close']()
  }
})

Deno.test('close sanitizes a credential-bearing URI in disconnect() failures', async () => {
  // P3 fix: `close()` used to pass the raw disconnect error straight to `logger.error` — the same
  // credential-leak risk `initialize()`'s own sanitization already guards against, just on the
  // opposite end of the connection's lifecycle.
  const db = new ZanixMongoConnector({ seedModel: false }) as any
  await db['initialize']()

  const originalDisconnect = Mongoose.prototype.disconnect
  const credentialBearingMessage =
    'Invalid connection string "mongodb://admin:S3cr3t@cluster0.mongodb.net/db"'
  Mongoose.prototype.disconnect = () => Promise.reject(new Error(credentialBearingMessage))

  const logged: unknown[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    logged.push(...args)
  }

  try {
    await db['close']()
  } finally {
    Mongoose.prototype.disconnect = originalDisconnect
    console.error = originalError
    await db['close']()
  }

  const output = logged.map((entry) => Deno.inspect(entry)).join(' ')
  assertEquals(output.includes('S3cr3t'), false)
  assertEquals(output.includes('[REDACTED]'), true)
})
