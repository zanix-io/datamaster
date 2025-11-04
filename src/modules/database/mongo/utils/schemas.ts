import type { SubschemaInfo } from '../typings/schema.ts'
import { Schema, type SchemaType } from 'mongoose'

/**
 * Recursively collects all nested (sub)schemas from a given Mongoose schema.
 *
 * This function handles various cases, including:
 *  - Direct subschemas (embedded documents)
 *  - Arrays of subschemas
 *  - Maps containing subschemas
 *
 * @param schema - The root Mongoose Schema to traverse.
 * @param parentPath - Internal use only. Represents the current path prefix for recursion.
 * @returns An array of objects containing each subschema and its full path.
 */
export function getAllSubschemas(schema: Schema, parentPath = ''): SubschemaInfo[] {
  const subschemas: SubschemaInfo[] = []
  const entries = Object.entries(schema.paths) as [
    string,
    SchemaType & { schemaType?: SchemaType },
  ][]
  // Iterate through all paths defined in the schema
  for (const [pathName, pathType] of entries) {
    const fullPath = parentPath ? `${parentPath}.${pathName}` : pathName
    let subSchema: Schema | null = null

    // 🧩 Case 1: direct subdocument
    if (pathType.schema instanceof Schema) {
      subSchema = pathType.schema
    } // 📦 Case 2: array or maps of subdocuments
    else if (pathType.schemaType?.schema instanceof Schema) {
      subSchema = pathType.schemaType.schema
    }

    // 🔁 If a subschema is found, register it and recurse into it
    if (subSchema) {
      subschemas.push({ path: fullPath, schema: subSchema })
      subschemas.push(...getAllSubschemas(subSchema, fullPath))
    }
  }

  return subschemas
}
