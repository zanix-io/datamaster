import type { AccessorsInfo, SchemaWithPaths } from 'mongo/typings/schema.ts'
import type { SchemaAccessor } from 'database/typings/general.ts'

/**
 * Recursively finds all paths in a schema that have getters or setters defined.
 *
 * @param {SchemaWithPaths} schema - The schema object containing paths.
 * @param {string} [parentPath=''] - The parent path prefix used for recursion.
 * @param {string[]} [result=[]] - Internal accumulator for results (used in recursion).
 * @returns {string[]} An array of full paths that have getters or setters defined.
 */
export function findPathsWithAccessorsDeep(
  schema: SchemaWithPaths,
  parentPath: string = '',
  result: never = {} as never,
): AccessorsInfo {
  const { getters = {}, setters = {} } = result as AccessorsInfo

  // Mongoose marks a Map's per-key (synthetic) schema path with a trailing
  // `.$*` segment. We reuse that same marker to track whether the schema
  // being iterated right now was reached through an ITERABLE container
  // (an array of subdocuments, or a Map) — the only case where a `.*.`
  // wildcard segment belongs in the paths we build below. A singular
  // embedded (sub)document has nothing to iterate, so its fields must be
  // joined with a plain `.` instead.
  const parentIsIterable = parentPath.endsWith('.$*')
  if (parentIsIterable) parentPath = parentPath.slice(0, -3)

  // Iterate over each path in the schema
  for (const path in schema.paths) {
    const pathObj = schema.paths[path]

    // Build the full path dynamically; include parent path if provided.
    // Only insert the `.*.` wildcard when the parent container is iterable —
    // otherwise this is a plain embedded object and the paths join directly.
    const fullPath = parentPath
      ? (parentIsIterable ? `${parentPath}.*.${path}` : `${parentPath}.${path}`)
      : path

    // If the current path has getters, add it to the result array
    if (pathObj.getters?.length) {
      const initials = getters[fullPath] || []
      getters[fullPath] = [...pathObj.getters, ...initials]
    }
    // If the current path has setters, add it to the result array
    if (pathObj.setters?.length && fullPath.slice(-3) !== '_id') {
      const initials = setters[fullPath] || []
      setters[fullPath] = [...pathObj.setters, ...initials]
    }

    // If the current path is an embedded subdocument, recurse into it
    if ('schema' in pathObj && pathObj.schema) {
      // Arrays of subdocuments are iterable but (unlike Maps) mongoose gives
      // them no synthetic `.$*` path of their own — mark the recursive call
      // ourselves so the next level knows to insert the wildcard segment.
      const nextParentPath = pathObj.instance === 'Array' ? `${fullPath}.$*` : fullPath

      findPathsWithAccessorsDeep(
        pathObj.schema,
        nextParentPath,
        { getters, setters } as never,
      )
    }
  }

  return {
    getters,
    setters,
    getterEntries: Object.entries(getters),
    setterEntries: Object.entries(setters),
  }
}

/**
 * Function to process an internal accessor and execute a calback action
 *
 * @param accessors
 * @param callback
 */
export const processInternalAccessors = (
  accessors: [string, SchemaAccessor[]][],
  callback: (opts: { function: SchemaAccessor; path: string }) => void,
) => {
  for (let i = 0; i < accessors.length; i++) {
    const [path, functions] = accessors[i]
    for (let j = 0; j < functions.length; j++) {
      callback({ function: functions[j], path })
    }
  }
}
