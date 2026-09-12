import type { AdaptedModel } from 'mongo/typings/models.ts'

/** What {@linkcode atomicClaim} resolves to. */
export type AtomicClaimResult<T> = {
  /** Whether THIS call's own write actually landed — `false` when a concurrent call won the claim
   * first (`filter`'s own anti-race condition no longer matched anything by the time this ran). */
  claimed: boolean
  /** The claimed document on a win. On a lost race, the CURRENT document under `options.identity`
   * (when given) — typically still the caller's own claim, just written by the concurrent call
   * instead of this one; `null` only when no document matches `options.identity` either, or when
   * `options.identity` was omitted (nothing to re-fetch). */
  document: T | null
}

/**
 * Runs a "claim this, but only if no one already has" write and its own race-loss recovery as one
 * atomic-then-verify step — the shape `GestureRepository.claimRecipient` and
 * `EventRepository.recordInterestAction`/`recordInterestMatch` each independently hand-rolled
 * (correctly, but twice) before this existed. The atomic half is exactly a `findOneAndUpdate`
 * whose OWN `filter` already encodes "not claimed yet" (`{ recipientUserId: { $exists: false } }`,
 * `{ interestActions: { $not: { $elemMatch: {...} } } }`, ...) — MongoDB either matches and writes
 * in one step, or matches nothing, so two concurrent calls for the same document can never both
 * "win". This only adds the part that's easy to skip under time pressure: `{ new: true }` (without
 * it, a WINNING call would return the document as it looked BEFORE the write — indistinguishable
 * from a loss), and the race-LOSS recovery every real caller of this pattern needs anyway — did a
 * concurrent call race this one, or is the document simply already claimed by someone else entirely.
 *
 * @template T - The claimed document's shape.
 * @param filter - The write's own filter, including whatever anti-race condition makes a second,
 * concurrent claim attempt match nothing (see the real examples above).
 * @param update - The write to apply once `filter` matches — a plain `$set`, a `$push`, whatever
 * the claim itself needs.
 * @param options.identity - A bare, unconditional lookup (e.g. `{ _id: id }`, never including
 * `filter`'s own anti-race condition — that part, by definition, no longer matches after a lost
 * race) used ONLY when the write above returns nothing, to find out who actually won. Omit it to
 * skip that lookup entirely and treat any lost race as `{ claimed: false, document: null }` — fine
 * for a caller with no need to distinguish "someone else already holds this" from "I lost a race
 * against my own retry".
 *
 * @returns {Promise<AtomicClaimResult<T>>} Whether this call won, and the resulting document.
 *
 * @example
 * ```ts
 * // Single-field claim, once — mirrors `GestureRepository.claimRecipient`.
 * const { claimed, document } = await Gesture.atomicClaim(
 *   { _id: id, recipientUserId: { $exists: false } },
 *   { recipientUserId: callerId },
 *   { identity: { _id: id } },
 * )
 * if (!document || (document.recipientUserId && document.recipientUserId !== callerId)) {
 *   throw new HttpError('FORBIDDEN', { message: 'Already claimed by another session.' })
 * }
 *
 * // Claim-once-per-pair, appended to an array — mirrors `EventRepository.recordInterestAction`.
 * const { document } = await Event.atomicClaim(
 *   { _id: id, interestActions: { $not: { $elemMatch: { fromId, toId } } } },
 *   { $push: { interestActions: action } },
 *   { identity: { _id: id } },
 * )
 * ```
 */
export async function atomicClaim<T = Record<string, unknown>>(
  this: AdaptedModel,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  options: { identity?: Record<string, unknown> } = {},
): Promise<AtomicClaimResult<T>> {
  const claimed = await this.findOneAndUpdate(filter, update, { new: true }).exec()
  if (claimed) return { claimed: true, document: claimed as T }

  if (!options.identity) return { claimed: false, document: null }

  const current = await this.findOne(options.identity).exec()
  return { claimed: false, document: current as T | null }
}
