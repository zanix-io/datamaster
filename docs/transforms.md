# Transforms

Utilities for walking and transforming a document's tree, and for inspecting a schema's shape. Most
consumers never call these directly — a schema's own `toJSON`/`toObject` transform already invokes
`transformByDataAccess`/`transformByDataProtection` automatically wherever
[`dataAccessGetter`](./data-protection.md#access-strategies-dataaccessgetter)/
[`dataProtectionGetter`](./data-protection.md#protection-strategies-dataprotectiongetter) are used.
Reach for the utilities below directly only for custom serialization paths outside the normal
document lifecycle (e.g. a script rewriting raw JSON).

## Recursive vs shallow

```ts
import { transformDeepByPaths, transformRecursively } from 'jsr:@zanix/datamaster@[version]'

// Walks the ENTIRE document tree, recursing indefinitely into every nested object/array.
transformRecursively(ret, {
  transformPrimitive: (v) => v,
  transformNested: (v, type) => v, // type: 'array' | 'object'
})

// Same, but only recurses into branches matched by `allowedPaths` ('*' matches any key at a level).
transformDeepByPaths(ret, {
  allowedPaths: ['metadata.*'],
  transformPrimitive: (v) => v,
})
```

```ts
import { transformShallowByPaths } from 'jsr:@zanix/datamaster@[version]'

// Walks straight to each path in `allowedPaths` and applies `transform` once there —
// does NOT recurse further into whatever it finds at that path.
transformShallowByPaths(ret, {
  allowedPaths: ['email', 'profile.bio'],
  transform: (value, path) => value,
})
```

Use `transformRecursively`/`transformDeepByPaths` when you need to reach every level of a
potentially deep/unknown-shape document; use `transformShallowByPaths` when you know exactly which
top-level paths need transforming and don't want to pay the cost of walking everything below them.
Both warn in their own doc comments that deep recursion can be expensive on large documents — prefer
the path-filtered variants over the fully-recursive ones when possible.

## Data-policy transforms

```ts
import { transformByDataAccess, transformByDataProtection } from 'jsr:@zanix/datamaster@[version]'
```

These are the schema-getter-facing wrappers that `toJSON()`/`toObject()` already call automatically,
driven by `Model._getDataAccessPaths()`/`_getDataProtectionPaths()` (populated from which fields use
`dataAccessGetter`/`dataProtectionGetter`). `transformByDataProtection` accepts
`{ excludeHashedFields?: boolean }` — used internally by
[`seedRotateProtectionKeys`](./data-protection.md#key-rotation), which calls it directly on a raw
document since key rotation happens outside the normal serialization path.

## Schema inspection

```ts
import { findPathsWithAccessorsDeep, getAllSubschemas } from 'jsr:@zanix/datamaster@[version]'

const subschemas = getAllSubschemas(schema)
// [{ path: 'address', schema: addressSchema }, ...] — recurses into embedded/array subdocuments

const { getters, setters, getterEntries, setterEntries } = findPathsWithAccessorsDeep(schema)
// getters/setters: { [dotNotatedPath]: SchemaAccessor[] }
// *Entries: the same maps as [path, accessors][] pairs
```

Both walk the schema definition itself (not documents) and are mostly useful for tooling built on
top of a schema — e.g. deciding which paths need special handling before defining a model.

## See also

- [Data Protection](./data-protection.md) — the getters that drive
  `transformByDataAccess`/`transformByDataProtection`.
- [Database](./database.md) — where these fit into a model's lifecycle.
