// deno-lint-ignore-file no-explicit-any
import type { DataProtection } from 'typings/protection.ts'

import { mask } from 'utils/protection.ts'
import { InternalError } from '@zanix/errors'

/** Boolean-combinator keys whose array elements are themselves filter conditions to recurse into. */
const FILTER_COMBINATORS = ['$or', '$and', '$nor'] as const

/**
 * Rewrites a Mongo filter's plaintext conditions on protected paths into their protected (masked)
 * form, in place — the read-side counterpart of `dataProtectionSetterDefinition`'s use in the
 * `updateOne`/`findOneAndUpdate` query hook (`processor/middlewares/data-protection.ts`), so a
 * filter written against plaintext can still match masked-at-rest data.
 *
 * Scoped to the `mask` strategy only: it's the one strategy guaranteed to be deterministic (no
 * salt/IV), so masking the same plaintext twice always produces the value a stored, masked field
 * can be matched against. `hash`/`encrypt` settings may randomize per call — safe for storage, but
 * re-hashing/re-encrypting a query value could produce something that never matches what's actually
 * stored, so a protected path configured with either throws rather than silently returning zero (or
 * wrong) results.
 *
 * Only a bare equality value, `$eq`, and `$in` are rewritten — the only shapes that stay meaningful
 * after a deterministic transform. Any other operator on a protected path (`$regex`, `$gt`, ...)
 * throws for the same reason: a masked field can't be partially/range-matched against a plaintext
 * pattern, so doing so silently would just return an always-wrong result set. Partial/substring
 * search against a masked field still needs `Model.mask(term)` applied by hand — see the
 * `useDataPolicies` section of `docs/DATA-PROTECTION.md` for why that stays a manual, per-call
 * decision this hook can't infer generically.
 *
 * `$or`/`$and`/`$nor` branches are recursed into, so a protected path used inside one is still
 * covered. Wildcard (`*`) protected paths are the caller's responsibility to exclude beforehand —
 * they don't address a literal filter key anyway.
 *
 * @param {Record<string, any>} filter - The query's filter/conditions object (mutated in place).
 * @param {string[]} allowedPaths - The protected paths to check for in `filter` (non-wildcard).
 * @param {Record<string, DataProtection>} dataProtection - The schema's data protection config, keyed by path.
 *
 * @returns {void} Mutates `filter` in place; no direct return value.
 */
export function protectFilterByPaths(
  filter: Record<string, any>,
  allowedPaths: string[],
  dataProtection: Record<string, DataProtection>,
): void {
  if (!filter) return

  for (const combinator of FILTER_COMBINATORS) {
    const branch = filter[combinator]
    if (Array.isArray(branch)) {
      for (const condition of branch) {
        protectFilterByPaths(condition, allowedPaths, dataProtection)
      }
    }
  }

  for (const path of allowedPaths) {
    if (!(path in filter)) continue

    const value = filter[path]
    if (value === null || value === undefined) continue

    const config = dataProtection[path]
    const activeConfig = config.versionConfigs[config.activeVersion] ??
      config.versionConfigs.default

    if (activeConfig?.strategy !== 'mask') {
      throw new InternalError('An error occurred during data processing', {
        cause: `Protected path '${path}' cannot be used in a 'useDataPolicies' query filter — ` +
          `only the 'mask' strategy is safe for deterministic query matching (its active ` +
          `version config uses '${activeConfig?.strategy}', which is not).`,
        meta: {
          source: 'zanix',
          suggestion:
            "Protect the filter value yourself before querying (e.g. Model.hash(value)), or omit 'useDataPolicies'.",
          path,
        },
      })
    }

    const isPlain = typeof value === 'string'
    const isEq = !isPlain && value && typeof value === 'object' &&
      '$eq' in value &&
      Object.keys(value).length === 1 && typeof value.$eq === 'string'
    const isIn = !isPlain && value && typeof value === 'object' &&
      '$in' in value &&
      Object.keys(value).length === 1 && Array.isArray(value.$in)

    if (!isPlain && !isEq && !isIn) {
      throw new InternalError('An error occurred during data processing', {
        cause: `Protected path '${path}' was used with an unsupported operator under ` +
          `'useDataPolicies' — only a plain equality match or '$in' can be protected automatically.`,
        meta: {
          source: 'zanix',
          suggestion:
            "Protect the value yourself before building the filter (e.g. Model.mask(value)), or omit 'useDataPolicies'.",
          path,
          operator: value,
        },
      })
    }

    if (isPlain) {
      filter[path] = mask(value, activeConfig.settings, config.activeVersion)
    } else if (isEq) {
      value.$eq = mask(value.$eq, activeConfig.settings, config.activeVersion)
    } else {
      // Each `$in` entry is an independent value, not parts of one grouped value — `mask()`'s array
      // form only prepends the version prefix to element 0 (it's meant for a single field whose own
      // stored value is an array, e.g. `String[]`), so masking the whole `$in` array in one call
      // would leave every entry after the first without its version prefix and never match what's
      // actually stored. Mask each entry on its own instead.
      value.$in = value.$in.map((entry: string) =>
        mask(entry, activeConfig.settings, config.activeVersion)
      )
    }
  }
}
