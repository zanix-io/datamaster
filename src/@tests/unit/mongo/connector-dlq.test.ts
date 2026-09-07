import type { ZanixMongoConnector } from 'mongo/connector/mod.ts'

import { assertEquals, assertExists, assertStrictEquals } from '@std/assert'
import { autoRegisterDlqModelOnStart } from 'mongo/connector/dlq.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'
import {
  defaultLeaseTtlMs,
  DLQ_MODEL_ENV,
  dlqModelName,
  isDlqModelRegistered,
  registerDlqModel,
} from 'modules/dlq/dlq.model.ts'
import ProgramModule from 'modules/program/mod.ts'

console.error = () => {}

/** A minimal stand-in for `ZanixMongoConnector` — `autoRegisterDlqModelOnStart` only ever reads
 * `resolvedConnectorKey`, so nothing else needs to exist on it. */
const fakeConnector = (connectorKey: string): ZanixMongoConnector =>
  ({ resolvedConnectorKey: connectorKey }) as unknown as ZanixMongoConnector

// This file's own module state (`dlqModelRegistered`, etc., in `dlq.model.ts`) starts fresh — Deno
// gives every test *file* its own module registry — but persists across `Deno.test` blocks WITHIN
// this file once set `true` (there's no matching "unregister"). Tests are ordered so that a case
// requiring `isDlqModelRegistered() === false` runs before any test that registers the model.

Deno.test('autoRegisterDlqModelOnStart: no-op against a non-default connector, even with DLQ_MODEL_NAME set', () => {
  Deno.env.set(DLQ_MODEL_ENV, 'custom-dlq')
  ProgramModule.models.deleteModels('mongo')

  try {
    autoRegisterDlqModelOnStart.call(fakeConnector('some-other-connector'))

    assertEquals(isDlqModelRegistered(), false)
    assertEquals(ProgramModule.models.getModels('mongo').length, 0)
  } finally {
    Deno.env.delete(DLQ_MODEL_ENV)
    ProgramModule.models.deleteModels('mongo')
  }
})

Deno.test('autoRegisterDlqModelOnStart: no-op against the default connector when DLQ_MODEL_NAME is unset', () => {
  Deno.env.delete(DLQ_MODEL_ENV)
  ProgramModule.models.deleteModels('mongo')

  autoRegisterDlqModelOnStart.call(fakeConnector(DEFAULT_CONNECTOR_KEY))

  assertEquals(isDlqModelRegistered(), false)
  assertEquals(ProgramModule.models.getModels('mongo').length, 0)
})

Deno.test('autoRegisterDlqModelOnStart: registers the DLQ model against the default connector once DLQ_MODEL_NAME is set', () => {
  Deno.env.set(DLQ_MODEL_ENV, 'auto-registered-dlq')
  ProgramModule.models.deleteModels('mongo')

  try {
    autoRegisterDlqModelOnStart.call(fakeConnector(DEFAULT_CONNECTOR_KEY))

    assertEquals(isDlqModelRegistered(), true)
    assertEquals(dlqModelName(), 'auto-registered-dlq')
    const registered = ProgramModule.models.getModels('mongo').find((m) =>
      m.name === 'auto-registered-dlq'
    )
    assertExists(registered)
  } finally {
    Deno.env.delete(DLQ_MODEL_ENV)
    ProgramModule.models.deleteModels('mongo')
  }
})

Deno.test('autoRegisterDlqModelOnStart: a second `initialize()` retry on the same connector instance does not re-register', () => {
  // `@zanix/server`'s `ZanixConnector` retries `initialize()` on the very same instance until it
  // succeeds or `timeoutConnection` elapses (`connectors/base.ts`) — e.g. Mongo isn't up yet on the
  // first attempt. This simulates exactly that: the auto-hook firing twice for the same
  // default-connector instance, with no explicit `registerDlqModel()` call from the app in between
  // (unlike the next test, which simulates an app's own prior explicit call instead).
  Deno.env.set(DLQ_MODEL_ENV, 'retry-dlq')
  ProgramModule.models.deleteModels('mongo')
  const connector = fakeConnector(DEFAULT_CONNECTOR_KEY)

  try {
    autoRegisterDlqModelOnStart.call(connector) // first attempt (connection then fails downstream)
    const countAfterFirst = ProgramModule.models.getModels('mongo').length

    autoRegisterDlqModelOnStart.call(connector) // retry, same connector instance, same process

    assertEquals(dlqModelName(), 'retry-dlq')
    assertStrictEquals(
      ProgramModule.models.getModels('mongo').length,
      countAfterFirst,
    )
  } finally {
    Deno.env.delete(DLQ_MODEL_ENV)
    ProgramModule.models.deleteModels('mongo')
  }
})

Deno.test("autoRegisterDlqModelOnStart: never re-runs (or overrides an explicit call's options) once the model is already registered", () => {
  // Simulates an app's own explicit `registerDlqModel(...)` call during bootstrap, before the
  // connector — and therefore the auto-hook — ever runs.
  Deno.env.delete(DLQ_MODEL_ENV)
  ProgramModule.models.deleteModels('mongo')
  registerDlqModel({ defaultLeaseMs: 12_345 })
  assertEquals(isDlqModelRegistered(), true)

  const registeredCountBefore = ProgramModule.models.getModels('mongo').length

  // DLQ_MODEL_NAME set here too — if the hook ignored `isDlqModelRegistered()`, it would call
  // `registerDlqModel()` again with no options, which would reset `defaultLeaseMs` back to the
  // built-in default (30s) — the exact silent-override this guard exists to prevent.
  Deno.env.set(DLQ_MODEL_ENV, 'should-not-be-used')

  try {
    autoRegisterDlqModelOnStart.call(fakeConnector(DEFAULT_CONNECTOR_KEY))

    assertEquals(defaultLeaseTtlMs(), 12_345)
    assertStrictEquals(
      ProgramModule.models.getModels('mongo').length,
      registeredCountBefore,
    )
  } finally {
    Deno.env.delete(DLQ_MODEL_ENV)
    ProgramModule.models.deleteModels('mongo')
    registerDlqModel() // reset the module-level cache for any test running after this file
  }
})
