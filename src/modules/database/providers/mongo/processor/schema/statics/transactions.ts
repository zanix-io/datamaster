import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { ClientSession, Document, SaveOptions } from 'mongoose'

import logger from '@zanix/logger'
import { HttpError } from '@zanix/errors'

/** MongoDB's own documented retry pattern for a transaction commit: `commitTransaction()` can
 * fail with one of these labels on a genuinely transient server-side condition (e.g. two
 * transactions racing to implicitly create the same brand-new collection) — the driver's own
 * guidance is to retry the commit itself, not treat it as a real failure on the first try. */
const RETRYABLE_COMMIT_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult']

const MAX_COMMIT_ATTEMPTS = 3

/** Commits `session`, retrying up to {@linkcode MAX_COMMIT_ATTEMPTS} times while the driver
 * itself labels the failure retryable (see {@linkcode RETRYABLE_COMMIT_LABELS}) — any other
 * error, or the last attempt, is re-thrown to the caller's own catch. */
const commitWithRetry = async (session: ClientSession, attempt = 1): Promise<void> => {
  try {
    await session.commitTransaction()
  } catch (e) {
    const labels = (e as { errorLabels?: string[] }).errorLabels ?? []
    const retryable = RETRYABLE_COMMIT_LABELS.some((label) => labels.includes(label))
    if (!retryable || attempt >= MAX_COMMIT_ATTEMPTS) throw e
    await commitWithRetry(session, attempt + 1)
  }
}

/**
 * Adds transaction handling to a Mongoose schema, allowing for the use of MongoDB transactions.
 *
 * This method provides a `startTransaction` static function to initiate a transaction on a schema, with
 * commit and abort functionality. It checks if the MongoDB instance supports transactions (either replica set or cluster),
 * and logs a warning if transactions are not supported.
 *
 * @this {Schema} The Mongoose schema that this method is added to.
 */
export const transactions = (schema: BaseCustomSchema): void => {
  schema.statics.startTransaction = async function () {
    // Start the transaction session
    const session = await this.startSession()

    const originalCreate = this.create.bind(this)
    const originalEndSession = session.endSession.bind(session)

    session.endSession = (opts?: unknown) => {
      this.create = originalCreate
      return originalEndSession(opts as never)
    }

    // Check if transactions are not supported
    if (!schema.statics.isReplicaSet()) {
      throw new HttpError('INTERNAL_SERVER_ERROR', {
        message: 'MongoDB instance does not support transactions.',
        cause: 'Transactions are only supported on replica sets or sharded clusters.',
        code: 'MONGODB_UNSUPPORTED_TRANSACTIONS',
        meta: { source: 'zanix' },
        shouldLog: true,
      })
    }

    // Customize create method to working with transactions
    this.create = ((doc: Document, opts: SaveOptions) => {
      return new this(doc).save(opts)
    }) as typeof originalCreate

    // Start the transaction
    session.startTransaction()

    const abort = async () => {
      if (session.hasEnded) {
        logger.debug('Session transaction has already been ended')
        return false
      }
      await session.abortTransaction()
      await session.endSession()
      return true
    }

    // Define the custom commit function
    const commit = async () => {
      if (session.hasEnded) {
        logger.debug('Session transaction has already been ended')
        return false
      }
      try {
        await commitWithRetry(session)
        await session.endSession()
        return true
      } catch (e) {
        logger.error('Transaction commit failed. Aborting operation.', e, {
          code: 'DB_TRANSACTION_COMMIT_FAILED',
          meta: {
            action: 'commit',
            outcome: 'aborted',
            source: 'zanix',
          },
        })
        // A commit failure can be ambiguous to the driver itself (e.g. a transient write-concern
        // timeout) — it may already treat the session as committed, in which case this abort
        // throws too ('Cannot call abortTransaction after calling commitTransaction'). The
        // commit already failed either way, so that throw must never escape uncaught here.
        await session.abortTransaction().catch(() => {})
        await session.endSession()
        return false
      }
    }

    return { session, commit, abort }
  }
}
