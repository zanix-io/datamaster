import type { DataFieldAccess } from 'database/typings/general.ts'
import type { Transform } from 'mongo/typings/schema.ts'
import type { Document } from 'mongoose'

import { dataAccessGetterDefinition } from 'database/data-policies/access.ts'
import { transformShallowByPaths } from './shallow.ts'
import { ProgramModule, type Session } from '@zanix/server'

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
 * @param {Record<string, DataFieldAccess>} dataAccess - An object mapping field names to their
 * corresponding data access configuration.
 * @returns A transformation function that can be used in the Mongoose schema options
 * (`toJSON.transform` or `toObject.transform`).
 */
export const transformByDataAccess = (dataAccess: Record<string, DataFieldAccess>): Transform => {
  const allowedPaths = Object.keys(dataAccess)

  if (!allowedPaths.length) return () => {}

  return (
    doc: Document,
    ret: Record<string, unknown>,
    options?: { userSession: Session; json?: boolean },
  ) => {
    const { userSession: session, json } = options || {}

    // When `userSession` is managed through `AsyncLocalStorage` (ALS),
    // and `userSession` is not provided manually, the object is serialized
    // using `toJSON` with data access getters enabled.
    // Otherwise a shallow transform without getters is applied.
    const ctx = ProgramModule.asyncContext.getStore()
    if (!session && ctx?.session) {
      ProgramModule.asyncContext.enterWith({ ...ctx, useDataAccessGet: true })

      const opts = { ...options, getters: true, transform: false }
      const tranformData = json ? doc.toJSON(opts) : doc.toObject({ ...opts, flattenMaps: true })
      // Data access getters require `flattenMaps: true` in `toObject()` to function correctly.

      ProgramModule.asyncContext.enterWith(ctx) // restore the context

      return tranformData
    }

    return transformShallowByPaths(ret, {
      allowedPaths: allowedPaths,
      transform: (value, path) => {
        return dataAccessGetterDefinition(dataAccess[path], value, session)
      },
    })
  }
}
