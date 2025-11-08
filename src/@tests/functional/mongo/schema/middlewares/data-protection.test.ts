// deno-lint-ignore-file no-explicit-any
import type { EncryptedString, MaskedString } from 'typings/data.ts'

import { DropCollection, getDB, ignore, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { aesKey, keys } from '../../../../(setup)/keys.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

const userSchema = new Schema({
  name: {
    type: String,
    get: dataProtectionGetter('mask'),
  },
  email: {
    type: String,
    get: dataProtectionGetter({ strategy: 'mask', settings: { endBefore: '@' } }),
  },
  secret: {
    type: String,
    get: dataProtectionGetter('encrypt'),
  },
  data: [
    new Schema({
      phones: {
        type: [String],
        get: dataProtectionGetter('hash'),
      },
    }),
  ],
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

Deno.test({
  ...sanitize,
  name: 'Data protection pre save should works correctly',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')

    const db = await getDB()

    const Model = await db.getModel('test-middlewares-pre-save', userSchema)

    const user = new Model({
      name: 'Ismael',
      email: 'pepito@email.com',
      password: 'my password',
      data: [{
        phones: ['+323323232323', '+2322323232'],
      }],
      secret: 'my secret',
      metadata: {
        emails: {
          value: 'pepito.perez@email.com',
        },
      },
    })

    Deno.env.set('DATA_RSA_KEY', btoa(keys.privateKey))
    Deno.env.set('DATA_RSA_PUB', btoa(keys.publicKey))
    Deno.env.set('DATA_AES_KEY', aesKey)

    const userSaved = await user.save()

    const json = userSaved.toJSON() as any

    const maskedName: MaskedString = userSaved.name

    assertEquals(maskedName?.unmask?.(), 'Ismael')
    assertEquals(json.name, 'v0:Zx240a4012000f')

    const maskedEmail: MaskedString = userSaved.email

    assertEquals(maskedEmail?.toString(), '16z7b7a6e787dxZx1d1c5d1a110c@email.com')
    assertEquals(json.email, 'v0:16z7b7a6e787dxZx1d1c5d1a110c@email.com')
    assertEquals(maskedEmail?.unmask?.(), 'pepito@email.com')

    const phones = userSaved.data[0].phones as any

    assert(await phones[0].verify('+323323232323'))
    assert(await phones[1].verify('+2322323232'))

    assert(json.data[0].phones[0] !== '+323323232323')
    assert(json.data[0].phones[1] !== '+2322323232')

    const email: EncryptedString = userSaved.metadata?.get('emails')?.value
    assertEquals(await email?.decrypt?.(), 'pepito.perez@email.com')
    assert(
      json.metadata?.emails.value && (json.metadata?.emails.value !== 'pepito.perez@email.com'),
    )

    const secret: EncryptedString = userSaved.secret
    assert(json.secret && (json.secret !== 'my secret'))
    assertEquals(await secret?.decrypt?.(), 'my secret')

    Deno.env.delete('DATA_SECRET_KEY')

    await DropCollection(Model, db)

    await db['stopConnection']()
  },
  ignore,
})
