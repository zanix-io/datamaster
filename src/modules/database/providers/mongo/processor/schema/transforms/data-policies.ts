import type { EncryptedString, MaskedString } from 'typings/data.ts'
import type { SchemaStatics } from 'mongo/typings/statics.ts'
import type { Transform } from 'mongo/typings/schema.ts'

import { dataProtectionGetterDefinition } from 'database/policies/protection.ts'
import { dataAccessGetterDefinition } from 'database/policies/access.ts'
import { ProgramModule as ServerProgram, type Session } from '@zanix/server'
import { transformShallowByPaths } from './shallow.ts'

/**
 * Enables and applies the data access policy during Mongoose document transformation
 * (`toJSON` or `toObject`).
 *
 * By default, the data access policy is applied when using `toJSON`.
 * If you want it to also apply to `toObject`, you must manually configure it in the schema options.
 *
 * This function receives a data access configuration that defines how each field should be
 * exposed or hidden depending on the current access policy.
 *
 * @param {object} options - Transform by data access options
 * @param {boolean} options.deleteMetadata - Optional deleteMetadata to indicate if is neccesary to delete metadata on allowed paths. (e.g. `_id`)
 *
 * @returns A transformation function that can be used in the Mongoose schema options
 * (`toJSON.transform` or `toObject.transform`).
 */
export const transformByDataAccess = (
  options: { deleteMetadata?: boolean } = {},
): Transform => {
  const { deleteMetadata } = options

  return (doc, ret, options?: { userSession: Session; json?: boolean }) => {
    const { userSession: session, json } = options || {}

    // When `userSession` is managed through `AsyncLocalStorage` (ALS),
    // and `userSession` is not provided manually, the object is serialized
    // using `toJSON` with data access getters enabled.
    // Otherwise a shallow transform without getters is applied.
    const ctx = ServerProgram.asyncContext.getStore()
    if (!session && ctx?.session) {
      ServerProgram.asyncContext.enterWith({ ...ctx, useDataAccessGet: true })

      const opts = { ...options, getters: true, transform: false }
      const tranformData = json ? doc.toJSON(opts) : doc.toObject({ ...opts, flattenMaps: true })
      // Data access getters require `flattenMaps: true` in `toObject()` to function correctly.

      ServerProgram.asyncContext.enterWith(ctx) // restore the context

      return tranformData
    }
    const statics = doc.schema.statics as unknown as SchemaStatics
    const dataAccess = statics._getDataAccess()
    const allowedPaths = statics._getDataAccessPaths()

    return transformShallowByPaths(ret, {
      deleteMetadata,
      allowedPaths,
      transform: (value, path) => {
        return dataAccessGetterDefinition(dataAccess[path], value, session)
      },
    })
  }
}

/**
 * Reverses the data protection policy during Mongoose document transformations
 * (`toJSON` or `toObject`).
 *
 * Normally, the data protection policy is applied when saving data (e.g., through Mongoose hooks)
 * and reversed when accessing data via the decrypt or unmask functions returned by getters.
 * This function is intended to be used in schema transformation options to automatically
 * decrypt or unmask all protected fields when a document is serialized.
 *
 * @param {object} options - Transform by data protection options
 * @param {boolean} options.deleteMetadata - Optional deleteMetadata to indicate if is neccesary to delete metadata on allowed paths. (e.g. `_id`)
 *
 * @returns {Transform} A transformation function compatible with Mongoose schema options
 * (`toJSON.transform` or `toObject.transform`).
 * The returned function is asynchronous, so you must use `await doc.toJSON()` or `await doc.toObject()`
 * when invoking it.
 */
export const transformByDataProtection = (
  options: { deleteMetadata?: boolean } = {},
): Transform => {
  const { deleteMetadata } = options

  return async (doc, ret) => {
    const promises: Promise<unknown>[] = []

    const statics = doc.schema.statics as unknown as SchemaStatics
    const dataProtection = statics._getDataProtection()
    const allowedPaths = statics._getDataProtectionPaths()

    ret = transformShallowByPaths(ret, {
      deleteMetadata,
      allowedPaths,
      transform: (value, path) => {
        // deno-lint-ignore ban-types
        const decodedValue = dataProtectionGetterDefinition(dataProtection[path], value) as String

        if (Object.hasOwn(decodedValue, 'unmask')) {
          const maskedString: MaskedString = decodedValue
          // deno-lint-ignore no-non-null-assertion
          return maskedString.unmask!()
        } else if (Object.hasOwn(decodedValue, 'decrypt')) {
          const encryptedString: EncryptedString = decodedValue
          // deno-lint-ignore no-non-null-assertion
          const decrypted = encryptedString.decrypt!()
          promises.push(decrypted)

          return decrypted
        }
      },
    })
    await Promise.all(promises)

    return ret
  }
}
