import type { BaseCustomSchema } from 'mongo/typings/schema.ts'

import { dataProtectionSetterDefinition } from 'database/policies/protection.ts'
import { transformShallowByPaths } from '../schema/transforms/shallow.ts'
import type { Document } from 'mongoose'

/**
 * Registers a Mongoose pre-save hook that enforces data protection rules.
 *
 * This function inspects the schema’s metadata to find the configured
 * data protection getters. For each protected path, it applies the corresponding
 * transform and executes the data protection getter before the document is saved.
 *
 * In short, it runs all data protection transformations defined in the schema
 * to ensure that sensitive fields are encrypted, masked or sanitized before persistence.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema where the data protection pre-save hook will be applied.
 *
 * @returns {void} Registers the pre-save hook on the schema (no direct return value).
 */
export const dataProtectionPreSave = (
  schema: BaseCustomSchema,
): void => {
  const dataProtection = schema.statics._getDataProtection()

  if (!schema.statics._hasDataProtection()) return

  const allowedPaths = schema.statics._getDataProtectionPaths()

  // Base data protection transform function
  const tranform = async function async(this: Document) {
    await transformShallowByPaths(this, {
      allowedPaths,
      transform: (value, path) => {
        return dataProtectionSetterDefinition(dataProtection[path], value)
      },
    })
  }

  // Pre save native hook
  schema.pre('save', async function (next) {
    if (!this.isNew) return next()
    await tranform.call(this)
    next()
  })

  // upsertById custom hook, defined once
  schema.addListener('upsertWithDataPolicy', async (Model, data, options, next) => {
    await tranform.call(data)
    await schema.statics.upsertById.call(Model, data, options)
    next()
  })

  // upsertManyById custom hook, defined once
  schema.addListener('upsertManyWithDataPolicy', async (Model, data, options, next) => {
    await Promise.all(data.map((ret: Document) => tranform.call(ret)))
    await schema.statics.upsertManyById.call(Model, data, options)
    next()
  })
}
