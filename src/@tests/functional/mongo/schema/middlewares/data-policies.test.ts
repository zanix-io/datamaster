import type { EncryptedString, MaskedString } from 'typings/data.ts'

import { DropCollection, getDB, ignore, sanitize } from '../../../../(setup)/mongo/connector.ts'
import { dataPoliciesGetter } from 'modules/database/policies/mod.ts'
import { assert, assertEquals } from '@std/assert'
import { keys } from '../../../../(setup)/keys.ts'
import { Schema } from 'mongoose'

// mocks
console.warn = () => {}

const userSchema = new Schema({
  name: {
    type: String,
    get: dataPoliciesGetter({
      access: 'protected',
      protection: { strategy: 'mask' },
    }),
  },
  maskVersioned: {
    type: String,
    get: dataPoliciesGetter({
      access: 'protected',
      protection: { activeVersion: 'v1', versionConfigs: { 'v1': { strategy: 'mask' } } },
    }),
  },
  maskVersionedArr: {
    type: [String],
    get: dataPoliciesGetter({
      access: 'protected',
      protection: {
        activeVersion: 'v100',
        versionConfigs: { 'v100': { strategy: 'mask', settings: { endBefore: '@' } } },
      },
    }),
  },
  encryptedVersioned: {
    type: String,
    get: dataPoliciesGetter({
      access: 'protected',
      protection: {
        activeVersion: 'v3',
        versionConfigs: { 'v3': { strategy: 'encrypt', settings: { type: 'symmetric' } } },
      },
    }),
  },
  encryptedVersionedArr: {
    type: [String],
    get: dataPoliciesGetter({
      access: 'protected',
      protection: {
        activeVersion: 'v2',
        versionConfigs: { 'v2': { strategy: 'encrypt', settings: { type: 'asymmetric' } } },
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

    const Model = await db.getModel('test-middlewares-policies-pre-save', userSchema)

    const user = new Model({
      name: 'Ismael',
    })

    const json = user.toJSON({ userSession: { type: 'user' } })

    const userSaved = await user.save()

    const maskedName: MaskedString = userSaved.name

    assert(json.name)
    assert(maskedName?.toString() !== json.name)
    assertEquals(maskedName?.unmask?.(), 'Ismael')

    await DropCollection(Model, db)
    await db['stopConnection']()
  },
  ignore,
})

Deno.test({
  ...sanitize,
  name: 'Data protection pre save should works correctly with versioned key',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    Deno.env.set('DATA_SECRET_KEY_V1', 'my-secret-key-1')
    Deno.env.set('DATA_SECRET_KEY_V100', 'my-secret-key-100')
    Deno.env.set('DATA_AES_KEY_V3', 'H3bkwjJIBUMt/ePUbJibeA==')
    Deno.env.set('DATA_RSA_PUB_V2', btoa(keys.publicKey))
    Deno.env.set('DATA_RSA_KEY_V2', btoa(keys.privateKey))

    const db = await getDB()

    const Model = await db.getModel('test-middlewares-policies-pre-save', userSchema)

    const user = new Model({
      name: 'Ismael',
      maskVersioned: 'My versioned data to mask',
      maskVersionedArr: ['pepito@email.com', 'pepita@email.com'],
      encryptedVersioned: 'My versioned data to encrypt',
      encryptedVersionedArr: [
        'My versioned data to encrypt arr 1',
        'My versioned data to encrypt arr 2',
      ],
    })

    const json = user.toJSON({ userSession: { type: 'user' } })

    const userSaved = await user.save()

    const jsonSaved = userSaved.toJSON({ userSession: { type: 'user' } })

    const maskedValue: MaskedString = userSaved.maskVersioned
    assert(jsonSaved.maskVersioned.startsWith('v1:'))
    assertEquals(maskedValue?.unmask?.(), json.maskVersioned)

    const maskedValueArr: MaskedString = userSaved.maskVersionedArr
    assert(userSaved.maskVersionedArr[0]?.endsWith('@email.com'))
    assert(jsonSaved.maskVersionedArr[0]?.startsWith('v100:'))
    assertEquals(maskedValueArr?.unmask?.(), json.maskVersionedArr)

    const encrypteddValue: EncryptedString = userSaved.encryptedVersioned
    assert(jsonSaved.encryptedVersioned?.startsWith('v3:'))
    assertEquals(await encrypteddValue?.decrypt?.(), json.encryptedVersioned)

    const encrypteddValueArr: EncryptedString = userSaved.encryptedVersionedArr

    assert(jsonSaved.encryptedVersionedArr[0]?.startsWith('v2:'))
    assertEquals(await encrypteddValueArr?.decrypt?.(), json.encryptedVersionedArr)

    await DropCollection(Model, db)
    await db['stopConnection']()
  },
  ignore,
})
