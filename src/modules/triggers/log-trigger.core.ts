/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { ZanixProvidersGetter } from '@zanix/server'

import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'
import { registerTriggerActionJob } from 'database/defs/trigger-actions.ts'
import { type LogTriggerActionData, writeLogTriggerEntry } from './log-trigger.ts'

/**
 * The `log` trigger action's job handler — delegates straight to {@link writeLogTriggerEntry}.
 * Typed against a minimal `this.providers` context (not `@zanix/asyncmq`'s own `Job` type),
 * matching `TriggerActionJobHandler`'s shape, for consistency with every other trigger-action job
 * across the ecosystem — this handler has no actual use for `this.providers`, since `@zanix/logger`
 * needs no provider lookup, but keeping the same signature means `log` behaves identically to
 * `mail`/`request` from `dispatch.ts`'s point of view.
 */
function logTriggerJobHandler(
  this: { providers: ZanixProvidersGetter },
  args: LogTriggerActionData,
): void {
  writeLogTriggerEntry(args)
}

/**
 * Self-registers the `log` trigger action's job descriptor with this package's own
 * `registerTriggerActionJob`. Unlike `mail` (owned by `@zanix/notifications`) or `request` (owned
 * by `@zanix/core`), `@zanix/datamaster` registers `log` itself: `@zanix/logger` is already one of
 * this package's own dependencies (`jsr:@zanix/utils/logger`, used throughout
 * `src/modules/database`/`src/modules/observability`/etc.), not a capability that belongs to
 * another package the way sending mail or firing an arbitrary HTTP request does — there's no
 * dependency-direction reason to leave this one for a sibling package or a consuming app to wire up
 * (see `zanix-dependency-direction`). `@zanix/core` still drains this descriptor the same way it
 * drains every other one and performs the real `@zanix/asyncmq` `registerJob` call — self-registering
 * here only means `log` has a real, working handler by default, not that it bypasses the mechanism.
 */
// Exported (not just auto-run below) — kept consistent with every other `core.ts` loader's own
// callable, re-invokable registration function across the Zanix ecosystem (see
// `storage/core.ts`'s own `registerS3Connector` doc for the full reasoning that pattern
// exists for).
export const registerLogTriggerJob = (): void => {
  registerTriggerActionJob('log', {
    name: DEFAULT_TRIGGER_JOBS.log,
    processingQueue: 'soft',
    handler: logTriggerJobHandler,
  })
}

/**
 * Core `log` trigger-action loader for Zanix.
 *
 * Self-registers `@zanix/datamaster`'s own job descriptor for its built-in `log` trigger action, so
 * it works end-to-end with zero consumer-side setup as soon as `@zanix/datamaster/core` is
 * imported — no sibling package or consuming app needs to register a handler for it, unlike
 * `mail`/`request` (see `docs/triggers.md`).
 *
 * Loaded from this package's own `modules/core.ts` — runs for both the main server process
 * (`Zanix.start()`) and the worker process (`Zanix.startWorker()`), so the registration reaches
 * whichever process actually executes the job.
 *
 * @decorator registerTriggerActionJob
 *
 * @module
 */
const zanixLogTriggerJobCore: void = registerLogTriggerJob()

export default zanixLogTriggerJobCore
