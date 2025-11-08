// deno-lint-ignore-file no-explicit-any
import { transformClearIdMetadata } from '../processor/schema/transforms/metadata.ts'
import type { RecoursiveTransformOptions } from '../typings/process.ts'
import { Document, type ToObjectOptions } from 'mongoose'

/** */
export function documentToPlainTransform(
  data: any,
  options: ToObjectOptions & { deleteMetadata?: boolean } = {},
) {
  if (!(data instanceof Document)) return data

  const { deleteMetadata, transform = false, virtuals = true, getters = false, ...opts } = options
  // Convert document to plain object
  const obj = data.toObject({ transform, virtuals, getters, ...opts })
  if (deleteMetadata) transformClearIdMetadata(obj as never, obj)

  return obj
}

/**
 * Base recursive transform function
 */
export function baseRecursiveTransform(
  data: any,
  transforms: RecoursiveTransformOptions,
  { transform = baseRecursiveTransform, getPaths }: {
    getPaths?: (key: string) => [string, string]
    transform?: (...args: any[]) => object
  } = {},
): object {
  // Default transforms to no-op functions
  const { deleteMetadata, transformPrimitive = (v) => v, transformNested = (v) => v } = transforms

  if (data === null || data === undefined) return data // Return null or undefined as is (no transformation needed)

  // Handle Mongoose document before recursion
  data = documentToPlainTransform(data, { deleteMetadata })

  if (data instanceof Map) {
    // Apply transform on each value in the Map
    for (const [key, value] of data) {
      data.set(key, transform(value, getPaths ? getPaths(key) : transforms))
    }

    return data
  }

  if (Array.isArray(data)) {
    // Apply transform recursively on each item
    data = data.map((item, index) =>
      transform(item, getPaths ? getPaths(index.toString()) : transforms)
    )

    return transformNested(data, 'array')
  }

  if (typeof data === 'object') {
    // Apply transformation on each field
    for (const key in data) {
      if (key === '_id') continue // skip metadata
      data[key] = transform(data[key], getPaths ? getPaths(key) : transforms)
    }

    if (deleteMetadata) transformClearIdMetadata(data, data)

    return transformNested(data, 'object')
  }

  // If it's a primitive value, apply the transformation
  return transformPrimitive(data)
}
