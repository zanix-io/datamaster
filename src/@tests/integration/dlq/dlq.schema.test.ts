// deno-lint-ignore-file no-explicit-any
import type { DecryptableObject } from 'typings/data.ts'
import type { SchemaStatics } from 'mongo/typings/statics.ts'

import { assertEquals } from '@std/assert'
import { model, Schema } from 'mongoose'
import { preprocessSchema } from 'mongo/processor/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'
import { dataProtectionGetter } from 'database/policies/protection.ts'
import { transformByDataProtection } from 'mongo/processor/schema/transforms/data-policies.ts'
import { registerDlqModel } from 'modules/dlq/dlq.model.ts'
import ProgramModule from 'modules/program/mod.ts'

console.error = () => {}

Deno.test('DLQ schema declares the claim-eligibility and processType/status indexes', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDlqModel()

  const registered = ProgramModule.models.getModels('mongo')[0]
  const schema = new Schema(registered.definition as never, registered.options)
  const finalSchema: any = registered.callback ? registered.callback(schema as never) : schema

  const indexedPaths = (finalSchema.indexes() as [Record<string, unknown>][])
    .map(([def]) => def)
  assertEquals(
    indexedPaths.some((def) => def.status === 1 && def.leaseExpiresAt === 1),
    true,
  )
  assertEquals(
    indexedPaths.some((def) => def.processType === 1 && def.status === 1),
    true,
  )

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('DLQ schema uses a native, queryable Mixed payload field by default', () => {
  ProgramModule.models.deleteModels('mongo')
  registerDlqModel()

  const registered = ProgramModule.models.getModels('mongo')[0]
  const schema = new Schema(registered.definition as never)
  preprocessSchema(
    schema as never,
    'dlq-schema-plain-test',
    DEFAULT_CONNECTOR_KEY,
  )

  const Model: any = model('DLQSchemaPlainTest', schema)
  const doc = new Model({
    processType: 'x',
    origin: 'x',
    payload: { orderId: 'abc123', nested: { a: 1 } },
    error: { name: 'Error', message: 'm' },
    errorHistory: [],
    attempts: 0,
    status: 'pending',
  })

  // Stored as a native, structured value — not a JSON string — so it's directly Mongo-queryable
  // via dot-notation (e.g. `{'payload.orderId': 'abc123'}`), unlike the encrypted-mode string form.
  assertEquals(doc.get('payload'), { orderId: 'abc123', nested: { a: 1 } })
  assertEquals(doc.get('payloadRaw'), undefined)

  ProgramModule.models.deleteModels('mongo')
})

Deno.test('DLQ schema encrypts/decrypts payloadRaw end-to-end with encryptPayload on', async () => {
  Deno.env.set('DATA_AES_KEY', 'hqIIz+SY/gZ7C9sDWSTiCA==')

  ProgramModule.models.deleteModels('mongo')
  registerDlqModel({ encryptPayload: true })

  const registered = ProgramModule.models.getModels('mongo')[0]
  const schema = new Schema(registered.definition as never)
  preprocessSchema(
    schema as never,
    'dlq-schema-encrypt-test',
    DEFAULT_CONNECTOR_KEY,
  )

  const Model: any & SchemaStatics = model('DLQSchemaEncryptTest', schema)

  const plaintext = JSON.stringify({ orderId: 'abc123' })
  const ciphertext = await Model.encrypt(plaintext, { type: 'symmetric' })

  const doc = new Model({
    processType: 'x',
    origin: 'x',
    payloadRaw: ciphertext,
    error: { name: 'Error', message: 'm' },
    errorHistory: [],
    attempts: 0,
    status: 'pending',
  })

  const decryptable: DecryptableObject = doc.payloadRaw
  assertEquals(await decryptable?.decrypt?.(), plaintext)

  Deno.env.delete('DATA_AES_KEY')
  ProgramModule.models.deleteModels('mongo')
})

Deno.test('DLQ schema: payloadFields protects one leaf, keeps its sibling queryable', async () => {
  Deno.env.set('DATA_AES_KEY', 'hqIIz+SY/gZ7C9sDWSTiCA==')

  ProgramModule.models.deleteModels('mongo')
  registerDlqModel({
    payloadFields: {
      orderId: { type: String },
      creditCard: { type: String, get: dataProtectionGetter('encrypt') },
    },
  })

  const registered = ProgramModule.models.getModels('mongo')[0]
  const schema = new Schema(registered.definition as never)
  preprocessSchema(
    schema as never,
    'dlq-schema-payload-fields-test',
    DEFAULT_CONNECTOR_KEY,
  )

  const Model: any & SchemaStatics = model(
    'DLQSchemaPayloadFieldsTest',
    schema,
  )
  const ciphertext = await Model.encrypt('4111-1111-1111-1111', {
    type: 'symmetric',
  })

  const doc = new Model({
    processType: 'x',
    origin: 'x',
    payload: { orderId: 'abc123', creditCard: ciphertext },
    error: { name: 'Error', message: 'm' },
    errorHistory: [],
    attempts: 0,
    status: 'pending',
  })

  // Direct path access reaches the nested getter, same as any other protected subdocument field.
  const creditCard: DecryptableObject = doc.payload.creditCard
  assertEquals(await creditCard?.decrypt?.(), '4111-1111-1111-1111')

  // `transformByDataProtection` — what `DlqProvider.toEntry()` actually uses — walks every
  // registered protected path (however deeply nested) at once, reversing it in place, and leaves
  // the undeclared field a plain, queryable value untouched.
  const snapshot = doc.toJSON({ getters: false, transform: false })
  const plain = await transformByDataProtection()(doc, snapshot)
  assertEquals(plain.payload.orderId, 'abc123')
  assertEquals(plain.payload.creditCard, '4111-1111-1111-1111')

  Deno.env.delete('DATA_AES_KEY')
  ProgramModule.models.deleteModels('mongo')
})
