export type Primitive = string | number | bigint | boolean | symbol | undefined | null

export type NestedValue =
  | Primitive
  | NestedValue[]
  | { [key: string]: NestedValue }
