import { assertEquals, assertNotEquals } from '@std/assert'
import { DropCollection, getDB, ignore, sanitize } from '../../(setup)/mongo/connector.ts'
import { registerDLQModel } from 'modules/dlq/dlq.model.ts'
import { DLQProvider } from 'modules/dlq/dlq.provider.ts'
import { dataProtectionGetter } from 'database/policies/protection.ts'
import type { ZanixMongoConnector } from 'database/mod.ts'

console.error = () => {}

// `defineModels` consumes (and clears) the registered-models bucket per connector construction —
// see `mongo/connector/models.ts`'s own doc comment ("clears the 'models' metadata to avoid
// redefinition"). So `registerDLQModel()` must run fresh right before each `getDB()` call, not once
// at module scope — mirrors `functional/mongo/models/data-model.test.ts`'s own per-test
// `registerModel(...)` pattern for the same reason.

// deno-lint-ignore no-explicit-any
const providerFor = (db: ZanixMongoConnector): any => {
  const instance = Object.create(DLQProvider.prototype)
  Object.defineProperty(instance, 'database', { value: db })
  return instance
}

/** Connects, drops any leftover `zanix-dlq` collection from a previous run, and returns both the
 * connector and a `DLQProvider` bound to it — every test starts from a clean collection. */
const freshProvider = async () => {
  registerDLQModel()
  const db = await getDB()
  await DropCollection(db.getModel('zanix-dlq'), db)
  return { db, provider: providerFor(db) }
}

const teardown = async (db: ZanixMongoConnector) => {
  await DropCollection(db.getModel('zanix-dlq'), db)
  await db['close']()
}

Deno.test({
  ...sanitize,
  name: 'DLQProvider full lifecycle against a real Mongo connection',
  fn: async () => {
    const { db, provider } = await freshProvider()

    try {
      const pushed = await provider.push({
        processType: 'payment.process',
        origin: 'orders-service',
        payload: { orderId: 'abc123' },
        error: { name: 'Error', message: 'boom' },
        maxAttempts: 2,
      })
      assertEquals(pushed.status, 'pending')
      assertEquals(pushed.attempts, 0)
      assertEquals(pushed.payload, { orderId: 'abc123' })

      const fetched = await provider.get(pushed._id)
      assertEquals(fetched.payload, { orderId: 'abc123' })

      // First claim/fail cycle — attempts (1) stays below maxAttempts (2), back to pending.
      const claimed = await provider.claim({
        leaseOwner: 'worker-1',
        processType: 'payment.process',
      })
      assertEquals(claimed?._id, pushed._id)
      assertEquals(claimed?.attempts, 1)

      const failed = await provider.fail(pushed._id, {
        leaseOwner: 'worker-1',
        error: { name: 'Error', message: 'still broken' },
      })
      assertEquals(failed.status, 'pending')
      assertEquals(failed.errorHistory.length, 2) // initial push + this fail

      // Second claim/fail cycle — attempts (2) reaches maxAttempts (2), moves to 'failed'.
      const claimedAgain = await provider.claim({
        leaseOwner: 'worker-2',
        processType: 'payment.process',
      })
      assertEquals(claimedAgain?.attempts, 2)

      const failedFinal = await provider.fail(pushed._id, {
        leaseOwner: 'worker-2',
        error: { name: 'Error', message: 'exhausted' },
      })
      assertEquals(failedFinal.status, 'failed')

      // Manual requeue bypasses maxAttempts.
      const requeued = await provider.requeue(pushed._id, {
        resetAttempts: true,
      })
      assertEquals(requeued.status, 'pending')
      assertEquals(requeued.attempts, 0)

      await provider.claim({
        leaseOwner: 'worker-3',
        processType: 'payment.process',
      })
      const completed = await provider.complete(pushed._id, {
        leaseOwner: 'worker-3',
      })
      assertEquals(completed.status, 'completed')

      const listResult = await provider.list({
        processType: 'payment.process',
      })
      assertEquals(listResult.total, 1)
      assertEquals(listResult.docs[0]._id, pushed._id)

      await provider.remove(pushed._id)
    } finally {
      await teardown(db)
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'DLQProvider.release lets a different worker reclaim the entry',
  fn: async () => {
    const { db, provider } = await freshProvider()

    try {
      const pushed = await provider.push({
        processType: 'release.test',
        origin: 'test',
        payload: {},
        error: { name: 'Error', message: 'boom' },
      })

      await provider.claim({
        leaseOwner: 'worker-1',
        processType: 'release.test',
      })
      const released = await provider.release(pushed._id, {
        leaseOwner: 'worker-1',
      })
      assertEquals(released.status, 'pending')

      const reclaimed = await provider.claim({
        leaseOwner: 'worker-2',
        processType: 'release.test',
      })
      assertEquals(reclaimed?._id, pushed._id)
      assertEquals(reclaimed?.leaseOwner, 'worker-2')
    } finally {
      await teardown(db)
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'DLQProvider.claim is safe under concurrent claimers — exactly one succeeds',
  fn: async () => {
    const { db, provider } = await freshProvider()

    try {
      const pushed = await provider.push({
        processType: 'concurrency.test',
        origin: 'test',
        payload: { n: 1 },
        error: { name: 'Error', message: 'boom' },
      })

      const results = await Promise.all(
        Array.from(
          { length: 8 },
          (_, i) =>
            provider.claim({
              leaseOwner: `worker-${i}`,
              processType: 'concurrency.test',
            }),
        ),
      )

      const successful = results.filter((r) => r !== null)
      assertEquals(successful.length, 1)
      assertEquals(successful[0]._id, pushed._id)

      const owners = new Set(results.map((r) => r?.leaseOwner).filter(Boolean))
      assertEquals(owners.size, 1)
    } finally {
      await teardown(db)
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'DLQProvider.claim reclaims an abandoned entry once its lease expires',
  fn: async () => {
    const { db, provider } = await freshProvider()

    try {
      const pushed = await provider.push({
        processType: 'lease-expiry.test',
        origin: 'test',
        payload: {},
        error: { name: 'Error', message: 'boom' },
      })

      // Claim with an already-in-the-past lease so it's immediately eligible again.
      const firstClaim = await provider.claim({
        leaseOwner: 'worker-1',
        processType: 'lease-expiry.test',
        leaseTtlMs: -1000,
      })
      assertNotEquals(firstClaim, null)

      const secondClaim = await provider.claim({
        leaseOwner: 'worker-2',
        processType: 'lease-expiry.test',
      })
      assertEquals(secondClaim?._id, pushed._id)
      assertEquals(secondClaim?.leaseOwner, 'worker-2')
    } finally {
      await teardown(db)
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name:
    "DLQProvider.claim uses registerDLQModel's defaultLeaseMs when no per-call leaseTtlMs is given",
  fn: async () => {
    registerDLQModel({ defaultLeaseMs: 2_000 })
    const db = await getDB()
    await DropCollection(db.getModel('zanix-dlq'), db)
    const provider = providerFor(db)

    try {
      const pushed = await provider.push({
        processType: 'default-lease.test',
        origin: 'test',
        payload: {},
        error: { name: 'Error', message: 'boom' },
      })

      const before = Date.now()
      const claimed = await provider.claim({
        leaseOwner: 'worker-1',
        processType: 'default-lease.test',
      })
      const after = Date.now()

      assertEquals(claimed?._id, pushed._id)
      const leaseExpiresAt = new Date(claimed?.leaseExpiresAt).getTime()
      // Bounded by [before + 2000, after + 2000] — proves the registered 2s default drove this
      // lease, not the built-in 30s default (which would fall far outside this window).
      assertEquals(leaseExpiresAt >= before + 2_000, true)
      assertEquals(leaseExpiresAt <= after + 2_000, true)
    } finally {
      await DropCollection(db.getModel('zanix-dlq'), db)
      await db['close']()
      registerDLQModel() // reset the module-level cache for later tests in this process
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'DLQProvider.list queries into payload sub-fields via a real Mongo dot-notation filter',
  fn: async () => {
    const { db, provider } = await freshProvider()

    try {
      const match = await provider.push({
        processType: 'query.test',
        origin: 'test',
        payload: { orderId: 'abc123', customer: { tier: 'gold' } },
        error: { name: 'Error', message: 'boom' },
      })
      await provider.push({
        processType: 'query.test',
        origin: 'test',
        payload: { orderId: 'other', customer: { tier: 'silver' } },
        error: { name: 'Error', message: 'boom' },
      })

      const byOrderId = await provider.list({
        filter: { 'payload.orderId': 'abc123' },
      })
      assertEquals(byOrderId.total, 1)
      assertEquals(byOrderId.docs[0]._id, match._id)

      const byNestedField = await provider.list({
        filter: { 'payload.customer.tier': 'gold' },
      })
      assertEquals(byNestedField.total, 1)
      assertEquals(byNestedField.docs[0]._id, match._id)
    } finally {
      await teardown(db)
    }
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'DLQProvider push/get round-trips a payloadFields-protected leaf via real Mongo',
  fn: async () => {
    Deno.env.set('DATA_AES_KEY', 'hqIIz+SY/gZ7C9sDWSTiCA==')
    registerDLQModel({
      payloadFields: {
        orderId: { type: String },
        creditCard: { type: String, get: dataProtectionGetter('encrypt') },
      },
    })
    const db = await getDB()
    await DropCollection(db.getModel('zanix-dlq'), db)
    const provider = providerFor(db)

    try {
      const pushed = await provider.push({
        processType: 'payload-fields.test',
        origin: 'test',
        payload: { orderId: 'abc123', creditCard: '4111-1111-1111-1111' },
        error: { name: 'Error', message: 'boom' },
      })
      // The pre-save hook encrypts `creditCard` on write (same mechanism as any other protected
      // field), and `toEntry()` reverses it on read — round-trips back to the original plaintext.
      assertEquals(pushed.payload, {
        orderId: 'abc123',
        creditCard: '4111-1111-1111-1111',
      })

      const fetched = await provider.get(pushed._id)
      assertEquals(fetched.payload, {
        orderId: 'abc123',
        creditCard: '4111-1111-1111-1111',
      })

      // The undeclared/unprotected sibling leaf stays natively queryable even though `creditCard`
      // is encrypted at rest.
      const found = await provider.list({
        filter: { 'payload.orderId': 'abc123' },
      })
      assertEquals(found.total, 1)
      assertEquals(found.docs[0]._id, pushed._id)
    } finally {
      await DropCollection(db.getModel('zanix-dlq'), db)
      await db['close']()
      Deno.env.delete('DATA_AES_KEY')
    }
  },
  ignore,
})
