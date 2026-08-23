// deno-lint-ignore-file no-explicit-any
import type { MongoSeeder, ReadDocumentsOptions } from 'mongo/typings/commons.ts'
import type { DataObject } from 'database/typings/models.ts'
import type { AdaptedModel } from 'mongo/typings/models.ts'
import type { Document } from 'mongoose'

import { transformByDataProtection } from 'mongo/processor/schema/transforms/data-policies.ts'
import { extractVersion } from 'utils/protection.ts'
import logger from '@zanix/logger'

/**
 * Seeder handler that ensures a single document exists in the collection, identified by its `id`.
 * If the document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `updateOne` for simplicity and atomic upsert.
 *
 * @function seedByIdIfMissing
 * @param {DataObject} data - Object representing the document to seed, containing a unique `id` property.
 * @param {boolean} [options.useDataPolicies] - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `true`.
 *
 * @returns {MongoSeeder} A seeder function that upserts one document by ID.
 *
 * @example
 * await seedByIdIfMissing({ id: 'u1', name: 'Admin' })(UserModel)
 */
export function seedByIdIfMissing(
  data: DataObject,
  options: { useDataPolicies?: boolean } = {},
): MongoSeeder {
  const { useDataPolicies = true } = options
  return async function seedByIdIfMissing(Model) {
    await Model.upsertById(data, { useDataPolicies })
  }
}

/**
 * Seeder handler that ensures multiple documents exist in the collection, each identified by its `id`.
 * If a document does not exist, it will be inserted; if it exists, it remains unchanged.
 *
 * Uses Mongoose's `bulkWrite` for high performance and atomic upserts.
 *
 * @function seedManyByIdIfMissing
 * @param {Array<DataObject>} data - Array of objects to seed, each containing a unique `id` property.
 * @param {boolean} [options.useDataPolicies] - Determines whether data policies should be applied to the seeded data.
 * For example, this could include masking sensitive fields or encrypting certain values. Defaults to `true`.
 *
 * @returns {MongoSeeder} A seeder function that upserts multiple documents by ID.
 *
 * @example
 * await seedManyByIdIfMissing([
 *   { id: 'u1', name: 'Admin' },
 *   { id: 'u2', name: 'User' }
 * ])(UserModel)
 */
export function seedManyByIdIfMissing(
  data: Array<DataObject>,
  options: { useDataPolicies?: boolean } = {},
): MongoSeeder {
  const { useDataPolicies = true } = options
  return async function seedManyByIdIfMissing(Model) {
    await Model.upsertManyById(data, { useDataPolicies })
  }
}

/**
 * Rotates data protection keys across the database by re-encrypting or re-masking
 * all protected fields using the new set of secrets or keys.
 *
 * This seed should be executed whenever encryption, hashing, or masking keys
 * have been changed to ensure that all persisted protected data remains consistent
 * with the new protection policies.
 *
 * The process typically involves:
 * 1. Decrypting or unmasking existing protected data using the old keys.
 * 2. Reapplying protection (encryption, masking, hashing) with the new keys.
 * 3. Updating the database records with the newly protected values.
 *
 * ⚠️ **Important:** This operation may be computationally expensive and should
 * only be executed during maintenance windows or as part of a controlled key rotation process.
 *
 * @returns {Promise<void>} Resolves when all protected fields have been updated.
 */
export function seedRotateProtectionKeys(
  options?: Omit<ReadDocumentsOptions<Document>, 'onDocument' | 'useLean'>,
): MongoSeeder {
  return async function seedRotateProtectionKeys(Model) {
    if (!Model._hasDataProtection()) {
      return logger.warn(
        'No data protection configuration found. Skipping execution of [seedRotateProtectionKeys]. ' +
          'Ensure that the model has proper data protection settings before attempting key rotation.',
        'noSave',
      )
    }

    const documents: DataObject[] = []
    await Model.readDocuments({
      ...options,
      useLean: false,
      onDocument: async (doc: Document) => {
        await transformByDataProtection({ excludeHashedFields: true })(
          doc,
          doc,
        )
        const response = doc.toJSON({ getters: false, transform: false })
        delete response.updatedAt
        delete response._id
        documents.push(response as DataObject)
      },
    })

    await Model.upsertManyById(documents, {
      useDataPolicies: true,
      type: 'update',
    })
  }
}

/** Per-path rotation status returned by {@link checkProtectionRotationStatus}. */
export type ProtectionRotationStatus = Record<string, {
  /** Documents with a defined value at this path. */
  total: number
  /** Of those, how many are already on the currently active protection version. */
  current: number
  /** Of those, how many are still on an older version — not yet safe to drop that old key. */
  outdated: number
}>

/**
 * Reports, per protected path, how many documents in the collection are still on an older
 * protection version versus the one currently active — the question
 * {@link seedRotateProtectionKeys} itself doesn't answer. That seeder processes the whole
 * collection in one pass, but a `bulkWrite` that exhausts its retries, or a write from a
 * not-yet-redeployed replica still using the old key mid-rollout, can leave some documents behind
 * without either failing loudly or telling you which records need attention.
 *
 * Call this **after** running {@link seedRotateProtectionKeys} — and again after fixing anything it
 * reports — before removing an old protection key from the environment. `outdated: 0` for every
 * path is what "safe to remove the old key" actually means; see
 * [Data Protection: key rotation](../../../../../docs/data-protection.md#key-rotation).
 *
 * Two kinds of paths are always skipped, matching {@link seedRotateProtectionKeys}'s own scope:
 * - **`hash`** — one-way, with no key/version to compare against (same reason
 *   `seedRotateProtectionKeys` excludes it via `excludeHashedFields`).
 * - **Wildcard (`*`) paths** — a per-element path inside an array of subdocuments; not yet
 *   supported (same limitation as `autoProtectOnUpdate`, see its own JSDoc).
 *
 * @param Model - The bound model to check.
 * @param options - The same read options `readDocuments` accepts (`mode`, `filter`, `limit`,
 * `batchSize`) except `onDocument`/`useLean`, which this function controls itself.
 * @returns A status object keyed by protected path, or `{}` if the model has no data protection
 * configured, or no path qualifies for a check (only `hash`/wildcard paths configured).
 *
 * @example
 * const status = await checkProtectionRotationStatus(UserModel)
 * // { ssn: { total: 500, current: 500, outdated: 0 }, email: { total: 500, current: 480, outdated: 20 } }
 * // `email` isn't fully rotated yet — keep the old key around.
 */
export async function checkProtectionRotationStatus(
  Model: AdaptedModel,
  options?: Omit<ReadDocumentsOptions<Document>, 'onDocument' | 'useLean'>,
): Promise<ProtectionRotationStatus> {
  if (!Model._hasDataProtection()) return {}

  const dataProtection = Model._getDataProtection()
  const checkablePaths = Model._getDataProtectionPaths().filter((path) => {
    if (path.includes('*')) return false

    const config = dataProtection[path]
    const strategy = config.versionConfigs[config.activeVersion]?.strategy ??
      config.versionConfigs['default']?.strategy

    return strategy !== 'hash'
  })

  if (!checkablePaths.length) return {}

  const status: ProtectionRotationStatus = {}
  for (const path of checkablePaths) {
    status[path] = { total: 0, current: 0, outdated: 0 }
  }

  await Model.readDocuments({
    ...options,
    useLean: true,
    onDocument: (doc: Record<string, any>) => {
      for (const path of checkablePaths) {
        const raw = doc[path]
        if (raw === undefined || raw === null) continue

        status[path].total++
        const { version } = extractVersion(raw)

        if (version === dataProtection[path].activeVersion) {
          status[path].current++
        } else status[path].outdated++
      }
    },
  })

  return status
}
