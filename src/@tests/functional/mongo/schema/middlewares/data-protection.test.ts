// deno-lint-ignore-file no-explicit-any
import type { EncryptedString } from 'typings/data.ts'

import { DropCollection, getDB, ignore, sanitize } from '../../../../_setup/mongo/connector.ts'
import { dataProtectionGetter } from 'modules/database/data-policies/protection.ts'
import { aesKey, keys } from '../../../../_setup/mongo/keys.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

const userSchema = new Schema({
  name: {
    type: String,
    get: dataProtectionGetter('masking'),
  },
  secret: {
    type: String,
    get: dataProtectionGetter('sym-encrypt'),
  },
  data: [
    new Schema({
      phones: {
        type: [String],
        get: dataProtectionGetter('hashing'),
      },
    }),
  ],
  metadata: {
    type: Map,
    of: new Schema({
      value: {
        type: String,
        get: dataProtectionGetter('asym-encrypt'),
      },
    }),
  },
})

Deno.test({
  ...sanitize,
  name: 'Data protection pre save should works correctly',
  fn: async () => {
    Deno.env.set('DATABASE_SECRET_KEY', 'my-secret-key')

    const db = await getDB()

    const Model = await db.getModel('test-middlewares-pre-save', userSchema)

    const user = new Model({
      name: 'Ismael',
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

    Deno.env.set('DATABASE_RSA_KEY', btoa(keys.privateKey))
    Deno.env.set('DATABASE_RSA_PUB', btoa(keys.publicKey))
    Deno.env.set('DATABASE_AES_KEY', aesKey)

    const userSaved = await user.save()

    const json = userSaved.toJSON() as any

    assertEquals(userSaved.name, 'Ismael')
    assertEquals(json.name, 'Zx240a4012000f')

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

    Deno.env.delete('DATABASE_SECRET_KEY')

    await DropCollection(Model, db)

    await db['stopConnection']()
  },
  ignore,
})
