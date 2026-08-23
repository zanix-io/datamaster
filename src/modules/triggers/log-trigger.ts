/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { LoggerMethods } from '@zanix/types'
import logger from '@zanix/logger'

/**
 * Payload contract for the `log` trigger action, as dispatched by
 * `database/providers/mongo/processor/triggers/dispatch.ts` — the action's own `level`/`message`
 * fields (already interpolated), plus the standard job envelope every trigger action job receives
 * (see the `Dispatched payload` section of `docs/triggers.md`).
 */
export type LogTriggerActionData = {
  /** The log level to write at — matches `@zanix/logger`'s own method names. */
  level: LoggerMethods
  /** The log message, already interpolated against the record the trigger fired for. */
  message: string
  /** The trigger's own dispatched envelope (`_data`/`_oldData`, plus any configured `data`). */
  data?: Record<string, unknown>
}

/**
 * Writes the `log` trigger action's entry via `@zanix/logger`. `success` only accepts a message
 * (no extra data, per `@zanix/logger`'s own `LoggerData<'success'>` signature) — every other level
 * also receives the trigger's dispatched envelope as a second argument, so the record that fired
 * the trigger is visible in the log output without needing to be interpolated into `message` by
 * hand.
 *
 * @param action The trigger's `log` action data.
 */
export function writeLogTriggerEntry(action: LogTriggerActionData): void {
  const { level, message, data } = action

  if (level === 'success') {
    logger.success(message)
    return
  }

  if (data === undefined) {
    logger[level](message)
    return
  }

  logger[level](message, data)
}
