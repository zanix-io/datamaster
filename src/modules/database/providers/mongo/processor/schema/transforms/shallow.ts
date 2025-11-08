// deno-lint-ignore-file no-explicit-any
import type { PathTransformOptions } from 'mongo/typings/process.ts'

import { documentToPlainTransform } from 'mongo/utils/transforms.ts'
import { transformClearIdMetadata } from './metadata.ts'

/**
 * Applies a transformation function to specific paths in a data structure at a shallow (superficial) level.
 *
 * This function iterates over the specified paths in `allowedPaths`, and applies the given transformation
 * to the values at those paths. The transformation is applied only to the direct values at the given paths
 * (not recursively to nested objects or arrays), except when the path includes a wildcard (`*`).
 * If the path includes a wildcard and there are subsequent keys, it will apply the transformation at those levels
 * as well, but will still not go deeper into further nested structures.
 *
 * Example:
 * - If `allowedPaths` contains `users` and `users.name`, the transformation will be applied to `users`
 *   and the `name` field of each user. But it won't apply to any deeper levels like `users.address.street`.
 * - If `allowedPaths` contains `users.*.name`, the transformation will be applied to all `name` fields under
 *   any item in the `users` array, but will not go deeper into nested objects or arrays.
 *
 * ⚠️ WARNING:
 * Using recursive transforms (wildcard mode) can significantly degrade performance, especially for large datasets or deeply nested structures.
 * It's crucial to optimize recursion or consider alternative approaches to ensure your code remains efficient and responsive.
 *
 * ℹ️ If the transform contains asynchronous operations, this function **returns a Promise**.
 *
 * @param {Record<string, any>} ret - The target data structure where the transformed data will be stored.
 * @param {PathTransformOptions} options - The transformation options:
 *   - `allowedPaths`: A list of paths (as strings) specifying where the transformations should be applied.
 *     The paths are shallow, meaning that only the direct values at those paths will be transformed, even if `*` is used.
 *     If a wildcard (`*`) is encountered in the path and is followed by another key, the transformation will apply to
 *     those subsequent keys as well, but will not recursively traverse further nested structures.
 *   - `transform`: A function to apply to the values at the specified paths. It takes a value and returns the transformed value.
 *   - `deleteMetadata`: Indicates if is neccesary to delete metadata on allowed paths. (e.g. `_id`)
 *
 * @returns {void} - This function modifies the `ret` object directly; no value is returned.
 *
 * @example
 * const data = {
 *   users: [
 *     { name: "John", age: 30 },
 *     { name: "Jane", age: 25 }
 *   ]
 * };
 *
 * const result = {};
 * transformShallowByPaths(data, result, {
 *   allowedPaths: ["users", "users.name"],
 *   transform: (value) => value.toUpperCase(),
 * });
 *
 * console.log(result);
 * // Output: { users: [ { name: "JOHN", age: 30 }, { name: "JANE", age: 25 } ] }
 *
 * // Example with wildcard:
 * transformShallowByPaths(data, result, {
 *   allowedPaths: ["users.*.name"],
 *   transform: (value) => value.toUpperCase(),
 * });
 *
 * console.log(result);
 * // Output: { users: [ { name: "JOHN", age: 30 }, { name: "JANE", age: 25 } ] }
 */
export function transformShallowByPaths(
  ret: Record<string, any>,
  options: PathTransformOptions,
): any {
  const { allowedPaths, deleteMetadata, transform = (v) => v } = options

  const promises: Promise<unknown>[] = []

  for (const path of allowedPaths) {
    const keys: any = path.split('.')
    if (keys[keys.length - 1] === '*') keys.length-- // avoiding last unnecessary '*'

    // --- Internal traversal function (iterative with minimal recursion for '*') ---
    const traverse = (src: any, dst: any, i: any) => {
      // Handle Mongoose document before recursion, to avoid getters calling
      src = documentToPlainTransform(src, { deleteMetadata })

      for (; i < keys.length; i++) {
        const isSrcMap = src instanceof Map
        const isDstMap = dst instanceof Map
        const isLast = i === keys.length - 1
        const key = keys[i]

        if (!src) return

        // Handle wildcard '*'
        if (key === '*') {
          // Get entries depending on source type
          let entries
          if (isSrcMap || Array.isArray(src)) {
            entries = src.keys()
          } else if (typeof src === 'object') {
            entries = Object.keys(src)
          } else {
            return
          }

          for (const k of entries) {
            const kidx = i + 1
            const lenVal = kidx < keys.length
            const nextDst = defineNextDst({ keys, kidx, dst, idx: k, isDstMap, lenVal })
            const nextSrc = isSrcMap ? src.get(k) : src[k]
            traverse(nextSrc, nextDst, i + 1)
          }
          return
        }

        // Detect numeric index
        const idx = detectNumericIndex(key, key.length < 12) ? +key : key

        // --- Source value ---
        const hasValue = isSrcMap ? src.has(idx) : idx in src

        if (!hasValue) return

        const value = isSrcMap ? src.get(idx) : src[idx]

        if (isLast) {
          if (deleteMetadata && dst._id) transformClearIdMetadata(dst, dst) // During the toObject transform, a new _id is regenerated when the document is deleted

          const response = transform(value, path)

          if (typeof response?.then !== 'function') {
            return responseValidation(response, idx, dst, isDstMap)
          }

          return promises.push(response.then((resp: unknown) => {
            responseValidation(resp, idx, dst, isDstMap)
          }))
        }

        dst = defineNextDst({ keys, kidx: i, dst, idx, isDstMap })
        src = value
      }
    }

    traverse(ret, ret, 0)
  }

  if (promises.length) return Promise.all(promises).then(() => ret)

  return ret
}

/** detect numeric index */
const detectNumericIndex = (key: any, lenVal = true) => {
  // Determine if next key is numeric → choose array or object/Map
  return lenVal && key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57
}

/** validate a transformation response on map */
const mapTValidation = (resp: any, idx: any, dst: Map<any, any>) => {
  if (resp) return dst.set(idx, resp)
  dst.delete(idx)
}

/** validate a transformation response on object */
const objTValidation = (resp: any, idx: any, dst: Record<string, unknown>) => {
  if (resp) return dst[idx] = resp
  delete dst[idx]
}

/** validate a transformation response */
const responseValidation = (resp: any, idx: any, dst: any, isDstMap: boolean) => {
  if (isDstMap) mapTValidation(resp, idx, dst)
  else objTValidation(resp, idx, dst)
}

/** define next destiny */
const defineNextDst = (
  opts: { keys: any; kidx: any; idx: any; isDstMap: boolean; dst: any; lenVal?: boolean },
) => {
  const { keys, idx, kidx, isDstMap, dst, lenVal } = opts
  const nextIsIndex = detectNumericIndex(keys[kidx], lenVal)

  if (isDstMap) {
    if (!dst.has(idx)) dst.set(idx, nextIsIndex ? [] : new Map())

    return dst.get(idx)
  }

  if (dst[idx] === null) dst[idx] = nextIsIndex ? [] : {}

  return dst[idx]
}
