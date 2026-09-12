import type { SchemaStatics } from 'mongo/typings/statics.ts'

import { dataAccessGetter } from 'modules/database/policies/access.ts'
import { model, Schema } from 'mongoose'
import { assert, assertEquals } from '@std/assert'
import { ProgramModule } from '@zanix/server'
import { preprocessSchema } from 'mongo/processor/mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

// mockups
console.warn = () => {}

let lastGrantCheck: { documentId: unknown; viewerId: string; field: string } | undefined
let grantResult = false

const userSchema = new Schema({
  userId: { type: String },
  shippingAddress: {
    // No `resolveGrant`: only the document's own owner ever sees it.
    type: String,
    get: dataAccessGetter({ strategy: 'conditional' }),
  },
  socialLinks: {
    // `resolveGrant` is called for any non-owner, authenticated viewer.
    type: String,
    get: dataAccessGetter({
      strategy: 'conditional',
      settings: {
        resolveGrant: (context) => {
          lastGrantCheck = context
          return grantResult
        },
      },
    }),
  },
})

preprocessSchema(userSchema as never, 'test-model', DEFAULT_CONNECTOR_KEY)

const userModel = model('Example-conditional-accessor', userSchema)
const UserModel = userModel as typeof userModel & SchemaStatics

const user = new UserModel({
  userId: 'owner-id',
  shippingAddress: 'Av. Always Sunny 123',
  socialLinks: 'https://example.com/owner',
})

Deno.test('conditional access - no session removes the field', () => {
  ProgramModule.asyncContext.enterWith({ id: 'ctx-id' })

  const obj = user.toObject({ getters: false })
  assert(!user.shippingAddress && obj.shippingAddress)
})

Deno.test('conditional access - anonymous session removes the field', () => {
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'anonymous' },
  })

  assert(!user.shippingAddress)
})

Deno.test('conditional access - owner sees the field', () => {
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'user', id: 'owner-id' },
  })

  assertEquals(user.shippingAddress, 'Av. Always Sunny 123')
})

Deno.test('conditional access - owner matched through `subject` over `id`', () => {
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'user', id: 'session-id', subject: 'owner-id' },
  })

  assertEquals(user.shippingAddress, 'Av. Always Sunny 123')
})

Deno.test('conditional access - non-owner with no resolveGrant never sees the field', () => {
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'user', id: 'someone-else' },
  })

  assert(!user.shippingAddress)
})

Deno.test('conditional access - non-owner is shown once resolveGrant approves them', () => {
  grantResult = true
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'user', id: 'someone-else' },
  })

  assertEquals(user.socialLinks, 'https://example.com/owner')
  assertEquals(lastGrantCheck?.viewerId, 'someone-else')
  assertEquals(lastGrantCheck?.field, 'socialLinks')
})

Deno.test('conditional access - non-owner is hidden once resolveGrant rejects them', () => {
  grantResult = false
  ProgramModule.asyncContext.enterWith({
    id: 'ctx-id',
    session: { type: 'user', id: 'someone-else' },
  })

  assert(!user.socialLinks)
})
