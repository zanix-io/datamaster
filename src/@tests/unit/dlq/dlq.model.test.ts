import { assertEquals, assertExists } from '@std/assert'
import {
  DEFAULT_DLQ_MODEL,
  defaultLeaseTtlMs,
  DLQ_DEFAULT_LEASE_MS_ENV,
  DLQ_ENCRYPT_PAYLOAD_ENV,
  DLQ_MODEL_ENV,
  dlqModelName,
  isDlqResourceEnabled,
  registerDLQModel,
} from 'modules/dlq/dlq.model.ts'
import ProgramModule from 'modules/program/mod.ts'

const withEnv = (env: string, value: string | undefined, fn: () => void) => {
  const previous = Deno.env.get(env)
  if (value === undefined) Deno.env.delete(env)
  else Deno.env.set(env, value)
  try {
    fn()
  } finally {
    if (previous === undefined) Deno.env.delete(env)
    else Deno.env.set(env, previous)
  }
}

Deno.test('dlqModelName defaults to zanix-dlq', () => {
  withEnv(DLQ_MODEL_ENV, undefined, () => {
    assertEquals(dlqModelName(), DEFAULT_DLQ_MODEL)
  })
})

Deno.test('dlqModelName honors DLQ_MODEL_NAME', () => {
  withEnv(DLQ_MODEL_ENV, 'custom-dlq', () => {
    assertEquals(dlqModelName(), 'custom-dlq')
  })
})

Deno.test('isDlqResourceEnabled: false when DLQ_MODEL_NAME is unset', () => {
  withEnv(DLQ_MODEL_ENV, undefined, () => {
    assertEquals(isDlqResourceEnabled(), false)
  })
})

Deno.test('isDlqResourceEnabled: true once DLQ_MODEL_NAME is set', () => {
  withEnv(DLQ_MODEL_ENV, 'custom-dlq', () => {
    assertEquals(isDlqResourceEnabled(), true)
  })
})

Deno.test('defaultLeaseTtlMs defaults to 30s', () => {
  withEnv(DLQ_DEFAULT_LEASE_MS_ENV, undefined, () => {
    assertEquals(defaultLeaseTtlMs(), 30_000)
  })
})

Deno.test('defaultLeaseTtlMs honors DLQ_DEFAULT_LEASE_MS', () => {
  withEnv(DLQ_DEFAULT_LEASE_MS_ENV, '5000', () => {
    assertEquals(defaultLeaseTtlMs(), 5000)
  })
})

Deno.test('defaultLeaseTtlMs falls back to the built-in default on an invalid value', () => {
  withEnv(DLQ_DEFAULT_LEASE_MS_ENV, 'not-a-number', () => {
    assertEquals(defaultLeaseTtlMs(), 30_000)
  })
  withEnv(DLQ_DEFAULT_LEASE_MS_ENV, '-100', () => {
    assertEquals(defaultLeaseTtlMs(), 30_000)
  })
})

Deno.test('registerDLQModel registers a model resolvable under dlqModelName()', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel()

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === dlqModelName())
  assertExists(registered)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel uses a native, unprotected Mixed payload field by default', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel()

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === dlqModelName())
  // deno-lint-ignore no-explicit-any
  const definition = registered?.definition as any
  assertEquals(definition.payload.type, Object)
  assertEquals(definition.payloadRaw, undefined)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel switches to a protected payloadRaw string field when enabled', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({ encryptPayload: true })

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === dlqModelName())
  // deno-lint-ignore no-explicit-any
  const definition = registered?.definition as any
  assertEquals(typeof definition.payloadRaw.get, 'function')
  assertEquals(definition.payload, undefined)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel: DLQ_ENCRYPT_PAYLOAD env var overrides the explicit option', () => {
  withEnv(DLQ_ENCRYPT_PAYLOAD_ENV, 'false', () => {
    ProgramModule.models.deleteModels('mongo')
    registerDLQModel({ encryptPayload: true })

    const registered = ProgramModule.models.getModels('mongo').find((m) =>
      m.name === dlqModelName()
    )
    // deno-lint-ignore no-explicit-any
    const definition = registered?.definition as any
    assertEquals(definition.payloadRaw, undefined)
    assertEquals(definition.payload.type, Object)

    ProgramModule.models.deleteModels('mongo')
  })
})

Deno.test('registerDLQModel: payloadFields declares a per-field-protectable subdocument', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({
    payloadFields: {
      orderId: { type: String },
      creditCard: { type: String, get: () => undefined },
    },
  })

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === dlqModelName())
  // deno-lint-ignore no-explicit-any
  const definition = registered?.definition as any
  assertEquals(definition.payload.orderId.type, String)
  assertEquals(typeof definition.payload.creditCard.get, 'function')
  assertEquals(definition.payloadRaw, undefined)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel: modelName option overrides the collection name', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({ modelName: 'app-dlq' })

  assertEquals(dlqModelName(), 'app-dlq')
  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === 'app-dlq')
  assertExists(registered)

  ProgramModule.models.deleteModels('mongo')
  registerDLQModel() // reset the module-level cache for later tests in this file
})

Deno.test('registerDLQModel: DLQ_MODEL_NAME env var overrides the modelName option', () => {
  withEnv(DLQ_MODEL_ENV, 'env-dlq', () => {
    ProgramModule.models.deleteModels('mongo')
    registerDLQModel({ modelName: 'app-dlq' })

    assertEquals(dlqModelName(), 'env-dlq')

    ProgramModule.models.deleteModels('mongo')
  })
  registerDLQModel() // reset the module-level cache for later tests in this file
})

Deno.test("registerDLQModel: a later call without modelName doesn't leak a prior value", () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({ modelName: 'app-dlq' })
  assertEquals(dlqModelName(), 'app-dlq')

  ProgramModule.models.deleteModels('mongo')
  registerDLQModel() // no modelName this time
  assertEquals(dlqModelName(), DEFAULT_DLQ_MODEL)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel: defaultLeaseMs option overrides the default claim() lease', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({ defaultLeaseMs: 45_000 })
  assertEquals(defaultLeaseTtlMs(), 45_000)

  ProgramModule.models.deleteModels('mongo')
  registerDLQModel() // reset the module-level cache for later tests in this file
})

Deno.test('registerDLQModel: DLQ_DEFAULT_LEASE_MS env var overrides defaultLeaseMs option', () => {
  withEnv(DLQ_DEFAULT_LEASE_MS_ENV, '5000', () => {
    ProgramModule.models.deleteModels('mongo')
    registerDLQModel({ defaultLeaseMs: 45_000 })
    assertEquals(defaultLeaseTtlMs(), 5000)
  })
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel() // reset the module-level cache for later tests in this file
})

Deno.test("registerDLQModel: a call without defaultLeaseMs doesn't leak a prior value", () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({ defaultLeaseMs: 45_000 })
  assertEquals(defaultLeaseTtlMs(), 45_000)

  ProgramModule.models.deleteModels('mongo')
  registerDLQModel() // no defaultLeaseMs this time
  assertEquals(defaultLeaseTtlMs(), 30_000)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('registerDLQModel: payloadFields takes priority over encryptPayload', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDLQModel({
    encryptPayload: true,
    payloadFields: { orderId: { type: String } },
  })

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === dlqModelName())
  // deno-lint-ignore no-explicit-any
  const definition = registered?.definition as any
  assertEquals(definition.payload.orderId.type, String)
  assertEquals(definition.payloadRaw, undefined)

  ProgramModule.models.deleteModels('mongo')
})
