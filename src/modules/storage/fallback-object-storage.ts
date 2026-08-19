/**
 * `createFallbackObjectStorage(primary, fallback)` — a generic `ObjectStorage` combinator, not
 * specific to S3/local: `put()` always goes to `primary` only (never split-written); `get()`/
 * `exists()` try `primary` first, falling back to `fallback` on a miss; `delete()` removes from
 * both (each is already a no-op for a missing key, per `ObjectStorage`'s own contract).
 *
 * Exists for one real scenario: an operator toggles the primary backend off (accidentally or
 * deliberately) after some objects were already written to `fallback`, then toggles it back on.
 * Read traffic for those objects must never come back empty just because the active backend
 * changed — the fallback is a safety net, not a design goal to keep two backends permanently in
 * sync by hand.
 *
 * `ensureSynced`, if given, is awaited before every operation — see `sync-local-objects.ts`'s own
 * doc for what it does. Its failure is logged, never thrown: a failed bulk migration attempt must
 * never block individual reads/writes, which the fallback already covers on its own, per-key,
 * regardless of whether the bulk pass ever succeeds.
 *
 * Ported from `@zanix/space`'s own test-support reference example (`createFallbackAssetStorage`)
 * into a real, published, generic export — it never depended on anything asset-specific in the
 * first place (pure `ObjectStorage`-in, `ObjectStorage`-out), so the move changes nothing about
 * its own behavior.
 *
 * @module
 */

import type { ObjectStorage } from './typings/general.ts'

import logger from '@zanix/logger'

export function createFallbackObjectStorage(
  primary: ObjectStorage,
  fallback: ObjectStorage,
  ensureSynced?: () => Promise<void>,
): ObjectStorage {
  const ready = async (): Promise<void> => {
    if (!ensureSynced) return
    try {
      await ensureSynced()
    } catch (error) {
      logger.error(
        'Local-to-primary object sync failed; continuing with per-key fallback only',
        error,
        {
          code: 'OBJECT_STORAGE_SYNC_ERROR',
        },
      )
    }
  }

  return {
    async put(key, data, meta) {
      await ready()
      return primary.put(key, data, meta)
    },

    async get(key) {
      await ready()
      const found = await primary.get(key)
      if (found) return found

      const foundInFallback = await fallback.get(key)
      if (foundInFallback) {
        logger.warn(
          `Object "${key}" was found only in the local fallback store, not the primary one — ` +
            `it likely predates the primary backend being configured, or the last sync attempt ` +
            `hasn't reached it yet.`,
          { code: 'OBJECT_STORAGE_FALLBACK_HIT', meta: { key } },
        )
      }
      return foundInFallback
    },

    async exists(key) {
      await ready()
      if (await primary.exists(key)) return true
      return await fallback.exists(key)
    },

    async delete(key) {
      await ready()
      await Promise.all([primary.delete(key), fallback.delete(key)])
    },
  }
}
