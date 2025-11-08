import type { SchemaStatics } from 'mongo/typings/statics.ts'
import type { EncryptedString, HashedString, MaskedString } from 'typings/data.ts'

import {
  dataProtectionGetter,
  dataProtectionSetterDefinition,
} from 'modules/database/policies/protection.ts'
import { keys } from '../../../../(setup)/keys.ts'
import { assert, assertEquals } from '@std/assert'
import { model, Schema } from 'mongoose'
import { preprocessSchema } from 'mongo/processor/mod.ts'

const userSchema = new Schema({
  name: String,
  password: {
    type: String,
    get: dataProtectionGetter('hash'),
  },
  data: [
    new Schema({
      phones: {
        type: [String],
        get: dataProtectionGetter('mask'),
      },
    }),
  ],
  secrets: {
    type: new Schema({
      aws: {
        type: String,
        get: dataProtectionGetter('encrypt'),
      },
    }),
  },
  metadata: {
    type: Map,
    of: new Schema({
      value: {
        type: String,
        get: dataProtectionGetter({ strategy: 'encrypt', settings: { type: 'asymmetric' } }),
      },
    }),
  },
})

preprocessSchema(userSchema as never)

const userModel = model('Example-accessor', userSchema)
const UserModel = userModel as typeof userModel & SchemaStatics

const user = new UserModel({
  name: 'Ismael',
  password: '3fd2063d03e328b6c8d51b5d628be5ba$AbNMp15zR0ISXipmld/LcrwCgMq/kra0QbfM3kacbag=',
  data: [{
    phones: ['Zx5c4b1e47505544524c15', 'Zx5c4b1e47505544524c14'],
  }],
  metadata: {
    emails: {
      value:
        'C/IJYbVb06Frp7RHolR8+l1QZ5yKyygV1p3fLTabnRzUNkutK6jTSKoCVX9o6oBEcnXiXpWemilYP7E8EE4hEC8hOwSS03mTEGU4F6qWh67y0CeYUhOq5b3eFbav0qCLnl/HlfZVKdDH4bQAULH445CIJHM1XRwig1Uko/QkXLopddfn2m/EP3uF9ag5MWU0Guzp47UAvr8A71lM5vkvFh5L1VtxFwPrEzXBOzceGpQ5/MkM35Kj0ESSQ8PXLw/yfS+JVFDGIM1ho3IiO8/eQz9Kf4+teeagQCigyFa03Ea00S6P5ZJnQ1gohCQD+I7wbTB7ls7mABk9cFQVtWYabw==',
    },
  },
  secrets: { aws: '9be2aeef079ed02370f994ab$8pxUyXr6oVFLYoZ8joztGMVE8A==' },
})

Deno.test('Validate data protection getter - hashing', async () => {
  const password: HashedString = user.password

  assert(
    password &&
      await UserModel.validateHash('My secret passwoRd', password.toString()) ===
        // deno-lint-ignore no-non-null-assertion no-extra-non-null-assertion no-non-null-asserted-optional-chain
        await password?.verify!('My secret passwoRd'),
  )
})

Deno.test('Validate data protection getter - masking', () => {
  Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')

  const phones: MaskedString = user.data[0].phones

  assertEquals(phones?.unmask?.(), ['1234566788', '1234566789'])

  Deno.env.delete('DATA_SECRET_KEY')
})

Deno.test('Validate data protection getter - sym encrypt', async () => {
  Deno.env.set('DATA_AES_KEY', 'hqIIz+SY/gZ7C9sDWSTiCA==')

  const aws: EncryptedString = user.secrets?.aws

  // deno-lint-ignore no-non-null-assertion no-extra-non-null-assertion no-non-null-asserted-optional-chain
  assertEquals(await aws?.decrypt!(), 'mys')
  assertEquals(aws && await UserModel.decrypt(aws.toString()), 'mys')
})

Deno.test('Validate data protection getter - asym encrypt', async () => {
  Deno.env.set('DATA_RSA_KEY', btoa(keys.privateKey))
  Deno.env.set('DATA_RSA_PUB', btoa(keys.publicKey))

  const value: EncryptedString = user.metadata?.get('emails')?.value

  // deno-lint-ignore no-non-null-assertion no-extra-non-null-assertion no-non-null-asserted-optional-chain
  assertEquals(await value?.decrypt!(), 'pepito.perez@email.com')
  assertEquals(
    value && await UserModel.decrypt(value.toString(), { type: 'asymmetric' }),
    'pepito.perez@email.com',
  )
})

Deno.test('Validate data protection setter - masking', async () => {
  Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')

  const data = await dataProtectionSetterDefinition({
    activeVersion: 'v1',
    versionConfigs: { v1: { strategy: 'hash' } },
  }, [
    '1234566788',
    '1234566789',
  ])

  assert(data[0])
  assert(user.data[0].phones[0] !== data[0])

  Deno.env.delete('DATA_SECRET_KEY')
})
