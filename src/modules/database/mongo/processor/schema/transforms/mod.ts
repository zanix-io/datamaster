import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { DataFieldAccess } from 'database/typings/general.ts'

import { transformClearIdMetadata } from './metadata.ts'
import { transformByDataAccess } from './data-access.ts'

/**
 * Wraps and extends a Mongoose schema's `toJSON` and `toObject` transformation with one or more custom transforms.
 *
 * @param {Schema} schema - The Mongoose schema to enhance with custom `toJSON` transformations.
 * @param {Array<Function>} transforms - An array of transformation functions to apply.
 * Each function should have the signature:
 * ```ts
 * (doc: any, ret: any, options: RuntimeContext) => void
 * ```
 */
const applyTransformations = (
  schema: BaseCustomSchema,
  // deno-lint-ignore no-explicit-any
  transforms: Array<((doc: any, ret: any, options?: any) => any)>,
  type?: 'toJSON' | 'toObject',
) => {
  const existingTransform = {
    toJSON: schema.get('toJSON')?.transform,
    toObject: schema.get('toObject')?.transform,
  }

  const applyTransform = (transformType: 'toJSON' | 'toObject') => {
    if (!type || type === transformType) {
      let baseTransform = existingTransform[transformType]
      if (typeof baseTransform !== 'function') {
        baseTransform = (_, ret) => ret // define a no-op
      }

      /**
       * ⚠️ WARNING: THIS SECTION IS RESERVED FOR TRANSFORMATIONS ⚠️
       * Do not add any additional logic or external operations
       * here, as it can negatively impact performance.
       * This section should only contain necessary transformations.
       */
      schema.set(transformType, {
        ...schema.get(transformType),
        transform: (doc, ret, options) => {
          const baseResponse = baseTransform(doc, ret, options)

          const internalTransforms = (ret: unknown) => {
            // Runs all internal transformation functions sequentially.
            // ⚠️ Only synchronous transforms are supported.
            for (const transform of transforms) {
              ret = transform(doc, ret, options) || ret
            }

            return ret
          }

          if (typeof baseResponse?.then === 'function') {
            return baseResponse.then((resp: unknown) => {
              return internalTransforms(resp || ret)
            })
          }

          return internalTransforms(baseResponse || ret)
        },
      })
    }
  }

  applyTransform('toJSON')
  applyTransform('toObject')
}

/**
 * Applies one or more transformation functions to a Mongoose schema's `toJSON` behavior.
 *
 * This function ensures that existing `toJSON` or `toObject` transforms are preserved and executed first,
 * then applies each transformation in the order provided. Transform functions can modify
 * the serialized output (`ret`) based on the document (`doc`) and the runtime context (`options`).
 *
 * Each transformation function should have the signature:
 * ```ts
 * (doc: any, ret: any, options: RuntimeContext) => void
 * ```
 *
 * Use cases include:
 * - Field access control (`public`, `protected`, `private`, `internal`)
 * - Masking or formatting sensitive data
 * - Adding computed or virtual fields to the serialized output
 *
 * @function baseTransformations
 * @param {BaseCustomSchema} schema - The Mongoose schema to enhance with transformations.
 * @returns {void} Modifies the schema in place by wrapping or extending its `toJSON` transform.
 */
export const baseTransformations = (
  schema: BaseCustomSchema,
  dataAccess: Record<string, DataFieldAccess>,
): void => {
  // Enable base schema options
  schema.set('toJSON', {
    getters: false,
    virtuals: true,
    versionKey: false,
    ...schema.get('toJSON'),
  })
  schema.set('toObject', {
    getters: false,
    virtuals: true,
    ...schema.get('toObject'),
  })

  applyTransformations(
    schema,
    [transformClearIdMetadata, transformByDataAccess(dataAccess)],
    'toJSON',
  )
}
