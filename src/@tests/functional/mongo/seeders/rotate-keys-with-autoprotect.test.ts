// deno-lint-ignore-file no-explicit-any
import { DropCollection, getDB, ignore, sanitize } from '../../../(setup)/mongo/connector.ts'
import { seedManyByIdIfMissing, seedRotateProtectionKeys } from 'mongo/utils/seeders.ts'
import { dataProtectionGetter } from 'modules/database/policies/protection.ts'
import { registerModel } from 'modules/database/defs/models.ts'
import { assert, assertEquals } from '@std/assert'

// `seedRotateProtectionKeys` reads documents via `readDocuments({ useLean: false, ... })` — real
// hydrated Documents, so `autoProtectOnUpdate`'s `post('init')` snapshot hook fires for them too.
// This proves the two features don't interfere: the rotation seeder never calls `.save()` on those
// documents (it decrypts into a throwaway plain snapshot and re-protects via `upsertManyById`
// instead), so the snapshot capture is a harmless, unused side effect for that specific flow — and
// a genuine `.save()` update on the SAME model, after rotation, still detects changes correctly
// against the newly-rotated (v1) value.

Deno.test({
  ...sanitize,
  name:
    'seedRotateProtectionKeys and autoProtectOnUpdate coexist on the same model without conflict',
  fn: async () => {
    Deno.env.set('DATA_SECRET_KEY', 'my-secret-key')
    const modelName = 'test-rotate-keys-with-autoprotect'

    registerModel({
      name: modelName,
      definition: {
        secret: { type: String, get: dataProtectionGetter('mask') },
      },
      extensions: {
        seeders: [
          seedManyByIdIfMissing([{
            id: '68fb00b33405a3a540d9b970',
            secret: 'original-secret',
          }]),
        ],
        autoProtectOnUpdate: true,
      },
    })

    const setupDb = await getDB()
    await setupDb['close']()

    // Rotate: activeVersion moves to v1, with its own key.
    Deno.env.set('DATA_SECRET_KEY_V1', 'my-secret-key-v1')

    registerModel({
      name: modelName,
      definition: {
        secret: {
          type: String,
          get: dataProtectionGetter({
            activeVersion: 'v1',
            versionConfigs: {
              v0: { strategy: 'mask' },
              v1: { strategy: 'mask' },
            },
          }),
        },
      },
      extensions: {
        seeders: [seedRotateProtectionKeys()],
        autoProtectOnUpdate: true,
      },
    })

    const db = await getDB() // runs the rotation seeder on boot
    const Model = db.getModel<any>(modelName)

    const rawRotated = (await Model.findOne({ _id: '68fb00b33405a3a540d9b970' }).lean()) as any
    assert(rawRotated.secret.startsWith('v1:')) // the wrapper's own .toString() strips the version prefix

    const rotated = await Model.findById('68fb00b33405a3a540d9b970')
    assertEquals(rotated.secret.unmask(), 'original-secret') // value survives the rotation intact

    // A genuine new value, after rotation, still gets protected — under the now-active v1 key.
    rotated.secret = 'post-rotation-secret'
    await rotated.save()

    const rawAfterChange = (await Model.findOne({ _id: rotated._id }).lean()) as any
    assert(rawAfterChange.secret.startsWith('v1:'))
    assert(rawAfterChange.secret !== rotated.secret) // re-masked, not the same literal value as before assignment

    const reloadedAfterChange = await Model.findById(rotated._id)
    assertEquals(reloadedAfterChange.secret.unmask(), 'post-rotation-secret')

    // An untouched reassignment of the freshly-rotated value is still detected as unchanged.
    const beforeNoop = (await Model.findOne({ _id: rotated._id }).lean()) as any
    reloadedAfterChange.secret = reloadedAfterChange.get('secret', undefined, {
      getters: false,
    })
    await reloadedAfterChange.save()
    const afterNoop = (await Model.findOne({ _id: rotated._id }).lean()) as any
    assertEquals(afterNoop.secret, beforeNoop.secret)

    Deno.env.delete('DATA_SECRET_KEY')
    Deno.env.delete('DATA_SECRET_KEY_V1')
    await DropCollection(Model, db)
    await db['close']()
  },
  ignore,
})
