import type { SchemaStatics } from 'mongo/typings/statics.ts'

import { dataAccessGetter } from 'modules/database/data-policies/access.ts'
import { statics } from 'mongo/processor/schema/statics/mod.ts'
import { model, Schema } from 'mongoose'
import { assert, assertEquals } from '@std/assert'
import { ProgramModule } from '@zanix/server'

// mockups
console.warn = () => {}

const userSchema = new Schema({
  name: {
    type: String,
    get: dataAccessGetter('private'),
  },
  password: {
    type: String,
    get: dataAccessGetter('internal'),
  },
  data: [
    new Schema({
      phones: {
        type: [String],
        get: dataAccessGetter({
          type: 'protected',
          virtualMask: { startAfter: 2, endBefore: 1 },
        }),
      },
    }),
  ],
})

statics(userSchema as never)

const userModel = model('Example-accessor', userSchema)
const UserModel = userModel as typeof userModel & SchemaStatics

const user = new UserModel({
  name: 'Ismael',
  password: '3fd2063d03e328b6c8d51b5d628be5ba$AbNMp15zR0ISXipmld/LcrwCgMq/kra0QbfM3kacbag=',
  data: [{
    phones: ['5c4b1e47505544524c15', '5c4b1e47505544524c14'],
    addresses: ['Av cl 23422', 'Av cl 23423'],
  }],
})

Deno.test('Validate data access getter - internal', () => {
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated', session: { type: 'user' } })

  const obj = user.toObject({ getters: false })
  const password = user.password

  assert(!password && obj.password)
})

Deno.test('Validate data access getter - private with authenticated user', () => {
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated', session: { type: 'user' } })

  const obj = user.toObject({ getters: false })
  const name = user.name

  assert(name && (obj.name === name))
})

Deno.test('Validate data access getter - private with anonymous user and no session', () => {
  const validation = () => {
    const obj = user.toObject({ getters: false })
    const name = user.name

    assert(!name && obj.name)
  }
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated', session: { type: 'anonymous' } })
  validation()

  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated' })
  validation()
})

Deno.test('Validate data access getter - protected with no session', () => {
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated' })

  const obj = user.toObject({ getters: false })
  const phones = user.data[0].phones

  assert(!phones && obj.data[0].phones)
})

Deno.test('Validate data access getter - protected with anonymous', () => {
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated', session: { type: 'anonymous' } })

  const obj = user.toObject({ getters: false })
  const phones = user.data[0].phones

  assertEquals(phones, ['5c*****************5', '5c*****************4'])
  assertEquals(obj.data[0].phones, ['5c4b1e47505544524c15', '5c4b1e47505544524c14'])
})

Deno.test('Validate data access getter - protected with authenticated user', () => {
  ProgramModule.asyncContext.enterWith({ id: 'id-authenticated', session: { type: 'user' } })

  const obj = user.toObject({ getters: false })
  const phones = user.data[0].phones

  assertEquals(phones, obj.data[0].phones)
})
