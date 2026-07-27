// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { ZanixMongoConnector } from 'mongo/connector/mod.ts'

// mocks
console.info = () => {}
console.error = () => {}

Deno.test('seedModel falls back to SEED_MODEL_NAME when omitted', async () => {
  Deno.env.set('SEED_MODEL_NAME', 'my-seed-model-from-env')
  try {
    const db = new ZanixMongoConnector({ triggersModel: false }) as any
    assertEquals(db.seederModel, 'my-seed-model-from-env')
    await db['close']()
  } finally {
    Deno.env.delete('SEED_MODEL_NAME')
  }
})

Deno.test('seedModel constructor option wins over SEED_MODEL_NAME', async () => {
  Deno.env.set('SEED_MODEL_NAME', 'from-env')
  try {
    const db = new ZanixMongoConnector({ seedModel: 'from-option', triggersModel: false }) as any
    assertEquals(db.seederModel, 'from-option')
    await db['close']()
  } finally {
    Deno.env.delete('SEED_MODEL_NAME')
  }
})

Deno.test("SEED_MODEL_NAME='false' disables seed tracking when seedModel is omitted", async () => {
  Deno.env.set('SEED_MODEL_NAME', 'false')
  try {
    const db = new ZanixMongoConnector({ triggersModel: false }) as any
    assertEquals(db.seederModel, false)
    await db['close']()
  } finally {
    Deno.env.delete('SEED_MODEL_NAME')
  }
})

Deno.test('seedModel defaults to "zanix-seeders" with no option or env var', async () => {
  const db = new ZanixMongoConnector({ triggersModel: false }) as any
  assertEquals(db.seederModel, 'zanix-seeders')
  await db['close']()
})

Deno.test('triggersModel falls back to TRIGGERS_MODEL_NAME when omitted', async () => {
  Deno.env.set('TRIGGERS_MODEL_NAME', 'my-triggers-model-from-env')
  try {
    const db = new ZanixMongoConnector({ seedModel: false }) as any
    assertEquals(db.triggersModel, 'my-triggers-model-from-env')
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_MODEL_NAME')
  }
})

Deno.test('triggersModel constructor option wins over TRIGGERS_MODEL_NAME', async () => {
  Deno.env.set('TRIGGERS_MODEL_NAME', 'from-env')
  try {
    const db = new ZanixMongoConnector({
      seedModel: false,
      triggersModel: 'from-option',
    }) as any
    assertEquals(db.triggersModel, 'from-option')
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_MODEL_NAME')
  }
})

Deno.test("TRIGGERS_MODEL_NAME='false' disables persisted triggers when omitted", async () => {
  Deno.env.set('TRIGGERS_MODEL_NAME', 'false')
  try {
    const db = new ZanixMongoConnector({ seedModel: false }) as any
    assertEquals(db.triggersModel, false)
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_MODEL_NAME')
  }
})

Deno.test('triggersPollInterval falls back to TRIGGERS_POLL_INTERVAL when omitted', async () => {
  Deno.env.set('TRIGGERS_POLL_INTERVAL', '5000')
  try {
    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
    assertEquals(db.triggersPollInterval, 5000)
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_POLL_INTERVAL')
  }
})

Deno.test('triggersPollInterval option (even false) wins over the env var', async () => {
  Deno.env.set('TRIGGERS_POLL_INTERVAL', '5000')
  try {
    const db = new ZanixMongoConnector({
      seedModel: false,
      triggersModel: false,
      triggersPollInterval: false,
    }) as any
    assertEquals(db.triggersPollInterval, false)
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_POLL_INTERVAL')
  }
})

Deno.test('TRIGGERS_POLL_INTERVAL disables polling when unset/"false"/non-numeric', async () => {
  const db1 = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
  assertEquals(db1.triggersPollInterval, false)
  await db1['close']()

  Deno.env.set('TRIGGERS_POLL_INTERVAL', 'false')
  try {
    const db2 = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
    assertEquals(db2.triggersPollInterval, false)
    await db2['close']()
  } finally {
    Deno.env.delete('TRIGGERS_POLL_INTERVAL')
  }

  Deno.env.set('TRIGGERS_POLL_INTERVAL', 'not-a-number')
  try {
    const db3 = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
    assertEquals(db3.triggersPollInterval, false)
    await db3['close']()
  } finally {
    Deno.env.delete('TRIGGERS_POLL_INTERVAL')
  }

  Deno.env.set('TRIGGERS_POLL_INTERVAL', '-100')
  try {
    const db4 = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
    assertEquals(db4.triggersPollInterval, false)
    await db4['close']()
  } finally {
    Deno.env.delete('TRIGGERS_POLL_INTERVAL')
  }
})

Deno.test('triggersChangeStream falls back to TRIGGERS_CHANGE_STREAM when omitted', async () => {
  Deno.env.set('TRIGGERS_CHANGE_STREAM', 'true')
  try {
    const db = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
    assertEquals(db.triggersChangeStream, true)
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_CHANGE_STREAM')
  }
})

Deno.test('triggersChangeStream constructor option wins over TRIGGERS_CHANGE_STREAM', async () => {
  Deno.env.set('TRIGGERS_CHANGE_STREAM', 'true')
  try {
    const db = new ZanixMongoConnector({
      seedModel: false,
      triggersModel: false,
      triggersChangeStream: false,
    }) as any
    assertEquals(db.triggersChangeStream, false)
    await db['close']()
  } finally {
    Deno.env.delete('TRIGGERS_CHANGE_STREAM')
  }
})

Deno.test('triggersChangeStream defaults to false with no option or env var', async () => {
  const db = new ZanixMongoConnector({ seedModel: false, triggersModel: false }) as any
  assertEquals(db.triggersChangeStream, false)
  await db['close']()
})
