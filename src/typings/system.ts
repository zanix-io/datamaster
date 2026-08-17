/** Any JavaScript primitive value. */
export type Primitive =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | undefined
  | null

/** A value that may recursively contain primitives, arrays, or plain objects. */
export type NestedValue =
  | Primitive
  | NestedValue[]
  | { [key: string]: NestedValue }
