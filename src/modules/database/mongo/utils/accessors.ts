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

  if (parentPath.endsWith('.$*')) parentPath = parentPath.slice(0, -3)

  // Iterate over each path in the schema
  for (const path in schema.paths) {
    const pathObj = schema.paths[path]

    // Build the full path dynamically; include parent path if provided
    const fullPath = parentPath ? `${parentPath}.*.${path}` : path

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
      findPathsWithAccessorsDeep(pathObj.schema, fullPath, { getters, setters } as never)
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
