/**
 * Removes metadata fields (e.g. '_id' and '__v') from the given object.
 *
 * This transformation function is specifically designed to remove common metadata
 * fields, such as `'_id'` and `'__v'`, which are typically added by databases
 * like MongoDB. It modifies the `ret` object in-place, deleting these properties
 * if they exist.
 *
 * This can be useful in scenarios where you want to clean up the object
 * before sending it to a client or applying further transformations.
 *
 * Example:
 * ```js
 * const ret = { _id: '12345', name: 'John', __v: 0 };
 * transformClearMetadata(ret);
 * console.log(ret); // { name: 'John' }
 * ```
 *
 * @param {Record<string, any>} ret - The target object from which metadata fields should be removed.
 */
export function transformClearAllMetadata(ret: Record<string, unknown>) {
  transformClearIdMetadata(ret)
  delete ret['__v']
}

/**
 * Removes metadata id field ('_id') from the given object.
 *
 * This transformation function is specifically designed to remove id metadata
 * field to clean up the object.
 *
 * @param ret
 */
export function transformClearIdMetadata(ret: Record<string, unknown>) {
  delete ret['_id']
}
