import { assertEquals } from '@std/assert'
import {
  DEFAULT_TRIGGERS_MODEL,
  isTriggersModelDisabled,
  isTriggersResourceEnabled,
  TRIGGERS_MODEL_ENV,
  triggersModelName,
} from 'mongo/connector/mod.ts'

function envTest(name: string, fn: () => void): void {
  Deno.test(name, () => {
    try {
      fn()
    } finally {
      Deno.env.delete(TRIGGERS_MODEL_ENV)
    }
  })
}

envTest(
  'isTriggersModelDisabled: false when TRIGGERS_MODEL_NAME is unset',
  () => {
    assertEquals(isTriggersModelDisabled(), false)
  },
)

envTest(
  'isTriggersModelDisabled: true only when TRIGGERS_MODEL_NAME is the literal "false"',
  () => {
    Deno.env.set(TRIGGERS_MODEL_ENV, 'false')
    assertEquals(isTriggersModelDisabled(), true)
  },
)

envTest(
  'isTriggersModelDisabled: false when TRIGGERS_MODEL_NAME is a real name',
  () => {
    Deno.env.set(TRIGGERS_MODEL_ENV, 'my-triggers')
    assertEquals(isTriggersModelDisabled(), false)
  },
)

envTest(
  'isTriggersResourceEnabled: true when TRIGGERS_MODEL_NAME is unset (inverse of isTriggersModelDisabled)',
  () => {
    assertEquals(isTriggersResourceEnabled(), true)
  },
)

envTest(
  'isTriggersResourceEnabled: false only when TRIGGERS_MODEL_NAME is the literal "false"',
  () => {
    Deno.env.set(TRIGGERS_MODEL_ENV, 'false')
    assertEquals(isTriggersResourceEnabled(), false)
  },
)

envTest(
  'isTriggersResourceEnabled: true when TRIGGERS_MODEL_NAME is a real name',
  () => {
    Deno.env.set(TRIGGERS_MODEL_ENV, 'my-triggers')
    assertEquals(isTriggersResourceEnabled(), true)
  },
)

envTest(
  'triggersModelName: defaults to DEFAULT_TRIGGERS_MODEL when unset',
  () => {
    assertEquals(triggersModelName(), DEFAULT_TRIGGERS_MODEL)
  },
)

envTest('triggersModelName: uses TRIGGERS_MODEL_NAME when set', () => {
  Deno.env.set(TRIGGERS_MODEL_ENV, 'my-triggers')
  assertEquals(triggersModelName(), 'my-triggers')
})
