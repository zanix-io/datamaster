import type { TriggerActions } from 'database/typings/triggers.ts'
import type { TriggerActionJobDescriptor } from 'modules/program/metadata/trigger-action-jobs.ts'

import ProgramModule from 'modules/program/mod.ts'

export type {
  TriggerActionJobDescriptor,
  TriggerActionJobHandler,
} from 'modules/program/metadata/trigger-action-jobs.ts'

/**
 * Built-in trigger action kinds whose job resolution goes through
 * {@link registerTriggerActionJob} — every key of `TriggerActions` except `custom`, which always
 * carries its own job name inline (see `TriggerActions.custom`).
 */
export type BuiltInTriggerActionType = Exclude<keyof TriggerActions, 'custom'>

/**
 * Registers the job a built-in trigger action kind (`mail`, `request`, `log`, or a future named
 * key added to `TriggerActions`) dispatches to. Called by whichever package owns that action's job
 * handler — `@zanix/notifications`, self-registered from its own `/core` entrypoint, for `mail`;
 * `@zanix/core` itself for the ownerless generic `request` action — never by this package for
 * `mail`/`request`, which only defines the mechanism for those. `@zanix/core` drains every
 * descriptor registered this way and performs the actual `@zanix/asyncmq` `registerJob` call for
 * each, so a registering package never needs to depend on `@zanix/asyncmq` itself (see
 * {@link getRegisteredTriggerActionJobs}). **`log` is the one built-in action this package
 * registers a real handler for itself** (`modules/triggers/log-trigger.core.ts`), since
 * `@zanix/logger` is already one of its own dependencies rather than another package's owned
 * capability — see that module's own doc.
 *
 * `mail`/`request`/`log` still dispatch correctly even if nothing calls this —
 * `DEFAULT_TRIGGER_JOBS` is the fallback `dispatch.ts` uses when no descriptor was registered for
 * them (`log` always resolves, since its self-registered handler backs that same default name once
 * `@zanix/datamaster/core` is imported).
 *
 * @throws An error if `actionKind` is already registered — same fail-fast semantics as
 * `@zanix/asyncmq`'s `registerJob`.
 *
 * @example
 * ```ts
 * registerTriggerActionJob('mail', {
 *   name: DEFAULT_TRIGGER_JOBS.mail,
 *   processingQueue: 'soft',
 *   handler: mailTriggerJobHandler,
 * })
 * ```
 */
export const registerTriggerActionJob = (
  actionKind: BuiltInTriggerActionType,
  descriptor: TriggerActionJobDescriptor,
): void => {
  ProgramModule.triggerActionJobs.register(actionKind, descriptor)
}

/**
 * Every trigger-action job descriptor registered so far via {@link registerTriggerActionJob}.
 * `@zanix/core` calls this once, after every package's own `/core` entrypoint has finished
 * loading, to perform the actual `@zanix/asyncmq` `registerJob` call for each descriptor.
 */
export const getRegisteredTriggerActionJobs = (): (
  & TriggerActionJobDescriptor
  & { actionKind: string }
)[] => {
  return ProgramModule.triggerActionJobs.getAll()
}
