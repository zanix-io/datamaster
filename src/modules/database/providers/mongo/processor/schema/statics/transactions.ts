import type { BaseCustomSchema } from 'mongo/typings/schema.ts'
import type { Document, SaveOptions } from 'mongoose'

import logger from '@zanix/logger'
import { HttpError } from '@zanix/errors'

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
        await session.commitTransaction()
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
        await session.abortTransaction()
        await session.endSession()
        return false
      }
    }

    return { session, commit, abort }
  }
}
