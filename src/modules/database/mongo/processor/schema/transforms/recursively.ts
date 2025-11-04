// deno-lint-ignore-file no-explicit-any
import type { PathDeepTransformOptions, RecoursiveTransformOptions } from 'mongo/typings/process.ts'
import { baseRecursiveTransform, documentToPlainTransform } from 'mongo/utils/transforms.ts'

/**
 * Recursively transforms a data structure (object, array, Map, etc.) by applying the provided transformation functions.
 *
 * This function will traverse all levels of the data structure and apply transformations to both primitive
 * and non-primitive values.
 *
 * ⚠️ WARNING:
 * Using recursive transforms can significantly degrade performance, especially for large datasets or deeply nested structures.
 * It's crucial to optimize recursion or consider alternative approaches to ensure your code remains efficient and responsive.
 *
 * @param {Record<string, any>} ret - The data structure to be transformed (can be an object, array, Map, etc.).
 * @param {RecoursiveTransformOptions} [transforms={}] - An optional object containing transformation functions:
 *   - `transformPrimitive`: Function to transform primitive values (string, number, boolean, etc.).
 *   - `transformNested`: Function to transform non-primitive values (objects, arrays, Maps, etc.).
 *
 * @returns {any} - The transformed data structure.
 *
 * @example
 * const data = {
 *   name: "John",
 *   age: 30,
 *   address: {
 *     city: "New York",
 *     zip: "10001"
 *   },
 * };
 *
 * const transformedData = transformRecursively(data, {
 *   transformPrimitive: (value) => value.toString(), // Transform primitive values to string
 *   transformNested: (value, type) => {
 *     if (type === 'object') {
 *       return Object.keys(value).reduce((acc, key) => {
 *         acc[key] = value[key].toUpperCase();
 *         return acc;
 *       }, {});
 *     }
 *     return value;
 *   }
 * });
 *
 * console.log(transformedData);
 */
export const transformRecursively = (
  ret: Record<string, any>,
  transforms: RecoursiveTransformOptions = {},
): any => baseRecursiveTransform(ret, transforms)

/**
 * Transforms a data structure by applying the provided transformation functions to specific paths.
 *
 * This function allows you to target specific paths in the data and apply different transformations
 * at each level of the path. If a path like `users` is provided in `allowedPaths`, the transformation
 * will continue down to the primitive values (e.g., `users.name`, `users.age`). If a wildcard `*` is used,
 * it will apply the transformation to all values at that level.
 *
 * Example:
 * - If `allowedPaths` contains just `users`, it will apply transformations to all `users.*` (e.g., `name`, `age`).
 * - If `allowedPaths` contains `users.*.name`, it will apply the transformation to the `name` field of every user.
 *
 * ⚠️ WARNING:
 * Using deep transforms can significantly degrade performance, especially for large datasets or deeply nested structures.
 * It's crucial to optimize recursion or consider alternative approaches to ensure your code remains efficient and responsive.
 *
 * @param {Record<string, any>} ret - The data structure to be transformed (can be an object, array, Map, etc.).
 * @param {PathDeepTransformOptions} options - An object containing transformation functions and allowed paths:
 *   - `allowedPaths`: A list of paths (as strings) indicating where the transformations should be applied.
 *     Each path can be a simple string (e.g., `users`), or a more specific path with `*` (e.g., `users.*.name`).
 *   - `transformPrimitive`: Function to transform primitive values (string, number, boolean, etc.).
 *   - `transformNested`: Function to transform non-primitive values (objects, arrays, Maps, etc.).
 *
 * @returns {object} - The transformed data structure.
 *
 * @example
 * const data = {
 *   users: [
 *     { name: "John", age: 30 },
 *     { name: "Jane", age: 25 }
 *   ]
 * };
 *
 * const transformedData = transformDeepByPaths(data, {
 *   allowedPaths: ["users"], // Applies transformation to all "name" and "age" fields within "users"
 *   transformPrimitive: (value) => value.toUpperCase(),
 *   transformNested: (value, type) => value
 * });
 *
 * console.log(transformedData);
 * // Output: { users: [ { name: "JOHN", age: 30 }, { name: "JANE", age: 25 } ] }
 */
export function transformDeepByPaths(
  ret: Record<string, any>,
  options: PathDeepTransformOptions,
): object {
  const { allowedPaths, transformPrimitive, transformNested, deleteMetadata } = options

  for (const segment of allowedPaths) {
    const keys = segment.split('.')

    /**
     * Recursive helper function to traverse data and apply transformations.
     *
     * @param src - The current parent object/Map containing the key.
     * @param dst - The destiny object/Map containing the key.
     * @param key - The current key to access in the parent.
     * @param remainingKeys - Remaining keys to traverse for this path.
     */
    const transform = (src: any, dst: any, key: string, remainingKeys: string[]) => {
      // Handle Mongoose document before recursion to avoid getters calling
      src = documentToPlainTransform(src, { deleteMetadata })

      // Get the current value from parent (handles Map or plain object)
      const nextSrc = src instanceof Map ? src.get(key) : src[key]
      const nextDst = dst instanceof Map ? dst.get(key) : dst[key]

      // CASE 1: wildcard '*' → iterate all keys at this level
      if (remainingKeys[0] === '*') {
        const rest = remainingKeys.slice(1)
        if (nextSrc instanceof Map) {
          for (const k of nextSrc.keys()) transform(nextSrc, nextDst, k, rest)
        } else if (typeof nextSrc === 'object' && nextSrc !== undefined) {
          for (const k of Object.keys(nextSrc)) {
            if (k === '_id') continue // skip metadata
            transform(nextSrc, nextDst, k, rest)
          }
        }
        return
      }

      // CASE 2: last key in path → apply transformation and overwrite reference
      if (remainingKeys.length === 1) {
        const lastKey = remainingKeys[0]
        if (nextSrc instanceof Map) {
          const inner = nextSrc.get(lastKey)
          if (inner !== undefined) {
            const transformed = baseRecursiveTransform(inner, {
              transformPrimitive,
              transformNested,
              deleteMetadata,
            })
            nextDst.set(lastKey, transformed)
          }
        } else if (typeof nextSrc === 'object' && nextSrc[lastKey] !== undefined) {
          nextDst[lastKey] = baseRecursiveTransform(nextSrc[lastKey], {
            transformPrimitive,
            transformNested,
            deleteMetadata,
          })
        }
        return
      }

      if (!nextSrc) return

      // CASE 3: no remaining keys
      if (remainingKeys.length === 0) {
        dst[key] = baseRecursiveTransform(nextSrc, {
          transformPrimitive,
          transformNested,
          deleteMetadata,
        })

        return
      }

      // CASE 4: descend to the next level
      const nextKey = remainingKeys[0]
      transform(nextSrc, nextDst, nextKey, remainingKeys.slice(1))
    }

    // Start the recursion with the first key
    if (keys[keys.length - 1] === '*') keys.length-- // avoiding last unnecessary '*'
    const [firstKey, ...rest] = keys
    transform(ret, ret, firstKey, rest)
  }

  return ret
}
