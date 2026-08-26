import { assertEquals } from '@std/assert'
import { ProgramModule } from '@zanix/server'
import { createDlqDiscoveryProvider } from 'modules/dlq/dlq-discovery.provider.ts'
import type { DlqProvider } from 'modules/dlq/dlq.provider.ts'
import type { DlqEntryAttrs, DlqListOptions, DlqStatus } from 'modules/dlq/dlq.typings.ts'
import type { DlqPaginatedResult } from 'modules/dlq/dlq.provider.ts'

/** Installs a fake `DlqProvider` behind `ProgramModule.providers.get`, restored via the returned
 * function — same technique `local-dlq.service.test.ts` uses for `DlqAdminService`'s own
 * `this.providers`, applied here to the shared `ProgramModule` singleton itself since
 * `createDlqDiscoveryProvider` resolves through it directly (mirroring
 * `createTriggersDiscoveryProvider`'s own deferred-resolution shape). */
function mockDlqProvider(list: (options: DlqListOptions) => Promise<DlqPaginatedResult>) {
  // `ProgramModule` itself is `Object.freeze`d (non-extensible), so a new own property can never
  // be defined directly on it — even one meant to shadow an inherited, configurable getter. The
  // real `providers` getter lives on its prototype instead, so the mock (and its restoration)
  // targets the prototype, not the frozen instance.
  const proto = Object.getPrototypeOf(ProgramModule)
  const original = Object.getOwnPropertyDescriptor(proto, 'providers')
  const fakeProvider = { list } as unknown as DlqProvider
  Object.defineProperty(proto, 'providers', {
    value: { get: () => fakeProvider },
    configurable: true,
  })
  return {
    restore: () => {
      if (original) {
        Object.defineProperty(proto, 'providers', original)
      } else {
        Reflect.deleteProperty(proto, 'providers')
      }
    },
  }
}

const entry = (id: string, status: DlqStatus): DlqEntryAttrs => ({
  _id: id,
  processType: 'payment.process',
  origin: 'orders-service',
  payload: { orderId: id },
  error: { name: 'Err', message: 'boom' },
  errorHistory: [],
  attempts: 0,
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const paginated = (docs: DlqEntryAttrs[]): DlqPaginatedResult => ({
  docs,
  page: 1,
  limit: 500,
  total: docs.length,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
})

Deno.test('snapshot() queries pending/claimed/failed, capped + sorted by recency', async () => {
  const calls: DlqListOptions[] = []
  const { restore } = mockDlqProvider((options) => {
    calls.push(options)
    const status = options.status as DlqStatus
    return Promise.resolve(paginated([entry(`${status}-1`, status)]))
  })

  try {
    const provider = createDlqDiscoveryProvider()
    const snapshot = await provider.snapshot()

    assertEquals(calls, [
      { status: 'pending', limit: 500, sort: { createdAt: -1 } },
      { status: 'claimed', limit: 500, sort: { createdAt: -1 } },
      { status: 'failed', limit: 500, sort: { createdAt: -1 } },
    ])
    assertEquals(snapshot.map((e) => e._id), ['pending-1', 'claimed-1', 'failed-1'])
  } finally {
    restore()
  }
})

Deno.test('snapshot() never queries completed/discarded entries', async () => {
  const queriedStatuses: (DlqStatus | undefined)[] = []
  const { restore } = mockDlqProvider((options) => {
    queriedStatuses.push(options.status)
    return Promise.resolve(paginated([]))
  })

  try {
    const provider = createDlqDiscoveryProvider()
    await provider.snapshot()

    assertEquals(queriedStatuses.includes('completed'), false)
    assertEquals(queriedStatuses.includes('discarded'), false)
  } finally {
    restore()
  }
})

Deno.test('snapshot() merges every status page into one flat array', async () => {
  const { restore } = mockDlqProvider((options) => {
    const status = options.status as DlqStatus
    const docs = [entry(`${status}-a`, status), entry(`${status}-b`, status)]
    return Promise.resolve(paginated(docs))
  })

  try {
    const provider = createDlqDiscoveryProvider()
    const snapshot = await provider.snapshot()

    assertEquals(snapshot.length, 6)
  } finally {
    restore()
  }
})
