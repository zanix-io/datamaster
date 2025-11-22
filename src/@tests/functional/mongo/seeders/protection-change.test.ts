// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { seedManyByIdIfMissing, seedRotateProtectionKeys } from 'mongo/utils/seeders.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { aesKey, keys } from '../../../(setup)/keys.ts'
import { assert, assertEquals } from '@std/assert'
import { Schema } from 'mongoose'

const closeConnection = async (Model: any, db: any) => {
  // Drop collection
  await DropCollection(Model, db)
  await db['close']()
}

const checkVerions = ([seeder1, seeder2]: any, version: string) => {
  const seeder1Json = seeder1.toJSON()
  const seeder2Json = seeder2.toJSON()

  assert(seeder1Json.name.startsWith(version))
  assert(seeder1Json.email.startsWith(version))
  assert(seeder1Json.metadata.emails.value[0].startsWith(version))

  assert(seeder2Json.name.startsWith(version))
  assert(seeder2Json.email.startsWith(version))
  assert(seeder2Json.metadata.emails.value[0].startsWith(version))
}

const checkOriginal = async ([seeder1, seeder2]: any) => {
  assert(await seeder1.name.decrypt() === 'Ismael')
  assert(seeder1.email.unmask() === 'pepito@email.com')
  assertEquals(
    await seeder1.metadata.get('emails').value.decrypt(),
    ['pepito.perez@email.com', 'pepito12.perez@email.com'],
  )

  assertEquals(await seeder2.name.decrypt(), 'Ismael 2')
  assertEquals(seeder2.email.unmask(), 'pepito2@email.com')
  assertEquals(
    await seeder2.metadata.get('emails').value.decrypt(),
    ['pepito2.perez@email.com', 'pepito22.perez@email.com'],
  )
}

Deno.test({
  ...sanitize,
  name: 'Mongo connector should run seeder [seedRotateProtectionKeys]',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    Deno.env.set('DATA_AES_KEY', 'H3bkwjJIBUMt/ePUbJibeA==')
    Deno.env.set('DATA_RSA_PUB', btoa(keys.publicKey))
    Deno.env.set('DATA_RSA_KEY', btoa(keys.privateKey))

    let assertExecuted = false

    registerModel({
      name: 'test-seeders-rotate-keys',
      definition: {
        name: {
          type: String,
          get: dataProtectionGetter('encrypt'),
        },
        email: {
          type: String,
          get: dataProtectionGetter('mask'),
        },
        metadata: {
          type: Map,
          of: new Schema({
            value: {
              type: [String],
              get: dataProtectionGetter({ strategy: 'encrypt', settings: { type: 'asymmetric' } }),
            },
          }),
        },
      },
      options: {
        timestamps: true,
      },
      extensions: {
        seeders: [
          seedManyByIdIfMissing([{
            id: '68fb00b33405a3a540d9b971',
            name: 'Ismael',
            email: 'pepito@email.com',
            metadata: {
              emails: {
                value: ['pepito.perez@email.com', 'pepito12.perez@email.com'],
              },
            },
          }, {
            id: '68fb00b33405a3a540d9b972',
            name: 'Ismael 2',
            email: 'pepito2@email.com',
            metadata: {
              emails: {
                value: ['pepito2.perez@email.com', 'pepito22.perez@email.com'],
              },
            },
          }]),
          async function asserts(Model) {
            // testing data ans seeder secuency
            const data = await Promise.all([
              Model.findById('68fb00b33405a3a540d9b971'),
              Model.findById('68fb00b33405a3a540d9b972'),
            ])
            checkVerions(data, 'v0:')
            await checkOriginal(data)
            assert(!data[0].email.toString().endsWith('email.com'))
            assertExecuted = true
          },
        ],
      },
    })

    await getDB() // initialize DB and seeders
    assert(assertExecuted)

    /** CHANGE KEYS */
    Deno.env.set('DATA_SECRET_KEY_V1', 'my-secret-key-v2')
    Deno.env.set('DATA_AES_KEY_V1', aesKey)

    registerModel({
      name: 'test-seeders-rotate-keys',
      definition: {
        name: {
          type: String,
          get: dataProtectionGetter({
            activeVersion: 'v1',
            versionConfigs: {
              v0: { strategy: 'encrypt' },
              v1: { strategy: 'encrypt' }, // with the new key
            },
          }),
        },
        email: {
          type: String,
          get: dataProtectionGetter({
            activeVersion: 'v1',
            versionConfigs: {
              v0: { strategy: 'mask' },
              v1: { strategy: 'mask', settings: { endBefore: '@' } },
            },
          }),
        },
        metadata: {
          type: Map,
          of: new Schema({
            value: {
              type: [String],
              get: dataProtectionGetter({
                activeVersion: 'v1',
                versionConfigs: {
                  v1: { strategy: 'encrypt' },
                  v0: { strategy: 'encrypt', settings: { type: 'asymmetric' } },
                },
              }),
            },
          }),
        },
      },
      options: {
        timestamps: true,
      },
      extensions: {
        seeders: [
          seedRotateProtectionKeys(),
        ],
      },
    })

    const db = await getDB() // initialize DB and key rotation seeder
    const Model = db.getModel<any>('test-seeders-rotate-keys')

    // testing data
    const dataChanged = await Promise.all([
      Model.findById('68fb00b33405a3a540d9b971'),
      Model.findById('68fb00b33405a3a540d9b972'),
    ])
    checkVerions(dataChanged, 'v1:')
    await checkOriginal(dataChanged)
    assert(dataChanged[0].email.toString().endsWith('email.com'))

    await closeConnection(Model, db)
  },
  ignore,
})
