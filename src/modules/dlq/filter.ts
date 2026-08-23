import { isPlainObject } from '@zanix/helpers'

/**
 * Strips every `$`-prefixed key from a raw filter object, recursively (plain objects and arrays of
 * objects alike) — a caller-supplied `filter` (`DLQListOptions.filter` / `DLQClaimOptions.filter`)
 * is documented as a dot-path equality lookup (e.g. `{ 'payload.orderId': 'abc123' }`), never a
 * place to hand the query engine raw Mongo operators. Left unsanitized, a `filter` sourced from an
 * untrusted caller (a host app's own HTTP layer, forwarding query-string filters) would let an
 * operator like `$where`/`$expr`/`$function` run arbitrary query-time logic, or a same-named
 * `$or`/`status` key silently widen/override the built-in scoping this module composes it with.
 *
 * Non-plain values (dates, ObjectIds, etc.) pass through untouched — only plain objects/arrays are
 * walked, so a legitimate filter value is never mangled.
 */
export function sanitizeMongoFilter(
  filter: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return stripDollarKeys(filter ?? {}) as Record<string, unknown>
}

function stripDollarKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDollarKeys)
  if (!isPlainObject(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$')) continue
    result[key] = stripDollarKeys(nested)
  }
  return result
}
