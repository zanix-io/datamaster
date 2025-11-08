import type { SchemaMethods } from 'mongo/typings/commons.ts'
import type { SchemaStatics } from 'mongo/typings/statics.ts'
import type { HashedString } from 'typings/data.ts'

import { dataPoliciesGetter } from 'modules/database/policies/mod.ts'
import { assert, assertEquals } from '@std/assert'
import { model, Schema } from 'mongoose'
import { preprocessSchema } from 'mongo/processor/mod.ts'
import { ProgramModule } from '@zanix/server'

// mockups
console.warn = () => {}

const userSchema = new Schema({
  name: {
    type: String,
    get: dataPoliciesGetter({ access: 'private', protection: 'mask' }),
  },
  password: {
    type: String,
    get: dataPoliciesGetter({ access: 'internal', protection: 'hash' }),
  },
  metadata: {
    type: Map,
    of: new Schema({
      value: {
        type: String,
        get: dataPoliciesGetter({ access: 'private', protection: 'mask' }),
      },
    }),
  },
  data: [
    new Schema({
      emails: {
        type: [String],
        get: dataPoliciesGetter({
          access: { strategy: 'protected', settings: { virtualMask: { endBefore: '@' } } },
          protection: { strategy: 'mask' },
        }),
      },
    }),
  ],
})

preprocessSchema(userSchema as never)

const userModel = model('Example-accessor', userSchema)
const UserModel = userModel as typeof userModel & SchemaStatics

const userDoc = new UserModel({
  name: 'Ismael',
  password: 'my pass',
  data: [{
    emails: ['pepito.perez@email.com', 'pepito.p@email.com'],
  }],
  metadata: {
    emails: {
      value:
        'C/IJYbVb06Frp7RHolR8+l1QZ5yKyygV1p3fLTabnRzUNkutK6jTSKoCVX9o6oBEcnXiXpWemilYP7E8EE4hEC8hOwSS03mTEGU4F6qWh67y0CeYUhOq5b3eFbav0qCLnl/HlfZVKdDH4bQAULH445CIJHM1XRwig1Uko/QkXLopddfn2m/EP3uF9ag5MWU0Guzp47UAvr8A71lM5vkvFh5L1VtxFwPrEzXBOzceGpQ5/MkM35Kj0ESSQ8PXLw/yfS+JVFDGIM1ho3IiO8/eQz9Kf4+teeagQCigyFa03Ea00S6P5ZJnQ1gohCQD+I7wbTB7ls7mABk9cFQVtWYabw==',
    },
  },
})

const user = userDoc as (SchemaMethods & typeof userDoc)

Deno.test('Data policies should works on toJSON transformation - authenticated user', () => {
  const session = { type: 'user' } as const

  const password: HashedString = user.password

  assert(password?.verify)

  const json = user.toJSON({ userSession: session })
  const obj = user.toObject()

  assert(!json.password)
  assert(json.name)
  assert(obj.data[0].emails)
  assertEquals(json.data[0].emails, obj.data[0].emails)

  /** using ALS */
  ProgramModule.asyncContext.enterWith({ id: 'my id', session })

  const jsonWithALS = user.toJSON({ virtuals: false })

  assert(!jsonWithALS.password)
  assert(jsonWithALS.name)
  assert(obj.data[0].emails)
  assertEquals(jsonWithALS.data[0].emails, obj.data[0].emails)
})

Deno.test(
  'Data policies should works on toJSON transformation - anonymous and no session',
  () => {
    const session = { type: 'anonymous' } as const

    assert(user.name)

    const json = user.toJSON({ userSession: session })

    assert(!json.name)
    assert(!json.password)
    assertEquals(json.data[0].emails, ['************@email.com', '********@email.com'])

    /** using ALS */
    ProgramModule.asyncContext.enterWith({ id: 'my id', session })

    const jsonWithALS = user.toJSON({ virtuals: false })

    assert(!jsonWithALS.name)
    assert(!jsonWithALS.password)
    assertEquals(jsonWithALS.data[0].emails, ['************@email.com', '********@email.com'])
  },
)
