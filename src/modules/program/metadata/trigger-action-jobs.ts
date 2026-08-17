import type { ZanixProvidersGetter } from '@zanix/server'
import { ProgramContainer } from '@zanix/server'
import { InternalError } from '@zanix/errors'

/**
 * A trigger-action job's execution logic. Deliberately typed against a minimal structural
 * context (`this.providers`) rather than `@zanix/asyncmq`'s own `Job` type, so a package
 * registering a descriptor (e.g. `@zanix/notifications`, for `mail`) never needs to depend on
 * `@zanix/asyncmq` itself — only whoever performs the real `registerJob` call does (`@zanix/core`).
 */
export type TriggerActionJobHandler<A = never> = (
  this: { providers: ZanixProvidersGetter },
  args: A,
) => Promise<unknown> | unknown

/**
 * Everything needed to register a real job for a built-in trigger action kind: the job name, its
 * processing-queue weight, and the handler logic itself.
 */
export type TriggerActionJobDescriptor<A = never> = {
  /** Job name — what `dispatch.ts` sends this action's dispatch to. */
  name: string
  /** Processing-queue weight `@zanix/asyncmq`'s `registerJob` expects. Defaults to `'soft'`. */
  processingQueue?: string
  /** The job's execution logic. */
  handler: TriggerActionJobHandler<A>
}

/**
 * A container mapping a built-in trigger action kind (`mail`, `request`, or a future named key on
 * `TriggerActions`) to the job descriptor it dispatches to. Populated by whichever package owns
 * that action's job handler (`@zanix/notifications`, for `mail`, self-registering from its own
 * `/core` entrypoint; `@zanix/core` itself, for the ownerless generic `request` action) — never by
 * this package, which only defines the mechanism. `@zanix/core` drains every registered descriptor
 * and performs the actual `@zanix/asyncmq` `registerJob` call — the one place that happens.
 */
export class TriggerActionJobsContainer extends ProgramContainer {
  #key = 'trigger-action-jobs'

  /**
   * Registers the job descriptor `actionKind` dispatches to.
   *
   * @throws `InternalError` if `actionKind` is already registered.
   */
  public register(
    actionKind: string,
    descriptor: TriggerActionJobDescriptor,
  ): void {
    const registry = this.getData<Record<string, TriggerActionJobDescriptor>>(this.#key) || {}

    if (registry[actionKind]) {
      throw new InternalError(
        `Trigger action registration failed: "${actionKind}" is already mapped to job "${
          registry[actionKind].name
        }".`,
      )
    }

    this

    registry[actionKind] = descriptor
    this.setData(this.#key, registry)
  }

  /** Resolves the job descriptor registered for `actionKind`, if any. */
  public resolve(actionKind: string): TriggerActionJobDescriptor | undefined {
    return this.getData<Record<string, TriggerActionJobDescriptor>>(this.#key)
      ?.[actionKind]
  }

  /** Every registered `{ actionKind, ...descriptor }` entry, in registration order. */
  public getAll(): (TriggerActionJobDescriptor & { actionKind: string })[] {
    const registry = this.getData<Record<string, TriggerActionJobDescriptor>>(this.#key) || {}
    return Object.entries(registry).map(([actionKind, descriptor]) => ({
      actionKind,
      ...descriptor,
    }))
  }
}
