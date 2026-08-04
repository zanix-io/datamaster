import type { AdaptedModel } from 'mongo/typings/models.ts'

import { mask } from 'utils/protection.ts'
import { InternalError } from '@zanix/errors'

/** Escapes every character with special meaning in a JS regex, so a raw search term is always
 * matched literally — never interpreted as a pattern (which would either throw on malformed input,
 * e.g. an unbalanced `(`, or let a caller-supplied term match far more than intended, e.g. `.*`). */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Builds a partial-match (`$regex`) search filter across `fields`, combined with an `$or`, plus any
 * direct-match `conditions` merged in alongside it — the generic form of the per-repository
 * "search across a few text fields, filter by a couple of exact ones" pattern this replaces.
 *
 * Each field in `fields` is checked against the model's own data protection config
 * (`_getDataProtection()`): a field with no protection configured gets a plain case-insensitive
 * substring `$regex`. A field protected with the `mask` strategy has the search term masked first
 * and matched as a **prefix** (`^...`), not an arbitrary substring — masking is a deterministic,
 * position-keyed transform (confirmed empirically: masking the same characters at the same starting
 * index always produces the same bytes, regardless of what follows), so only a term that starts at
 * position 0 of the plaintext is guaranteed to mask to a matching prefix of the stored value; a term
 * that only occurs in the middle masks to different bytes than what's actually stored there. A field
 * protected with `hash`/`encrypt` throws instead of silently returning nothing — neither strategy is
 * substring- or even prefix-preserving, so there's no way to build any partial match against what's
 * actually stored.
 *
 * @this {AdaptedModel} The bound Mongoose model.
 * @param {string} [query] - The search term. Falsy (`undefined`, `''`) skips the `$or` entirely —
 * only `conditions` (if any) are returned.
 * @param {string[]} fields - The schema paths to search across.
 * @param {Record<string, unknown>} [conditions] - Direct-match conditions merged into the returned
 * filter alongside the `$or` (e.g. `{ status: 'active' }`).
 *
 * @returns {Record<string, unknown>} A MongoDB filter object, ready to pass to `find`/`paginate`/
 * `paginateCursor`, or merge into a larger filter yourself.
 *
 * @example
 * const filter = Model.buildSearchFilter(query, ['name', 'legalName', 'taxId'], { status })
 * await Model.paginate({ filter })
 */
export function buildSearchFilter(
  this: AdaptedModel,
  query: string | undefined,
  fields: string[],
  conditions?: Record<string, unknown>,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...conditions }
  if (!query) return filter

  const dataProtection = this._getDataProtection()

  filter.$or = fields.map((field) => {
    const config = dataProtection[field]
    if (!config) return { [field]: { $regex: escapeRegExp(query), $options: 'i' } }

    const activeConfig = config.versionConfigs[config.activeVersion] ??
      config.versionConfigs.default

    if (activeConfig?.strategy !== 'mask') {
      throw new InternalError('An error occurred during data processing', {
        cause: `Search field '${field}' cannot be used in 'buildSearchFilter' — only the 'mask' ` +
          `strategy allows any partial match (a prefix one) against what's stored (its active ` +
          `version config uses '${activeConfig?.strategy}', which does not).`,
        meta: {
          source: 'zanix',
          suggestion: `Remove '${field}' from the searchable fields, or query it separately.`,
          field,
        },
      })
    }

    // Anchored: masking is position-keyed, so only a term starting at index 0 of the plaintext is
    // guaranteed to mask to a matching prefix of the stored value — see this function's own JSDoc.
    const maskedTerm = mask(query, activeConfig.settings, config.activeVersion)
    return { [field]: { $regex: `^${escapeRegExp(maskedTerm)}`, $options: 'i' } }
  })

  return filter
}
