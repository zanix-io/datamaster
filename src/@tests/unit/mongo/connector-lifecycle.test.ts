// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { Mongoose } from 'mongoose'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}

Deno.test('initialize logs an error and does not throw when connect() rejects', async () => {
  const originalConnect = Mongoose.prototype.connect
  Mongoose.prototype.connect = () => Promise.reject(new Error('connection refused'))

  try {
    const db = new ZanixMongoConnector({ seedModel: false }) as any
    await db['initialize']()
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
  Mongoose.prototype.connect = async function (this: Mongoose, uri: string, options: unknown) {
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
