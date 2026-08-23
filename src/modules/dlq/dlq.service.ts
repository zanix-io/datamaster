import type {
  DLQDiscardOptions,
  DLQEntryAttrs,
  DLQListOptions,
  DLQPushInput,
  DLQRequeueOptions,
} from './dlq.typings.ts'
import type { DLQPaginatedResult } from './dlq.provider.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { DLQProvider } from './dlq.provider.ts'

/**
 * Business logic behind this package's own local `/admin/dlq` — see
 * `./dlq-api/local-dlq.handler.ts`'s `createDlqAdminController`.
 *
 * Unlike `TriggersAdminService` (which delegates to a separate `TriggersAdminRepository`),
 * `DLQProvider` already IS the data-access layer for this collection — it directly owns the Mongo
 * model, the `HttpError('NOT_FOUND'/'CONFLICT')` semantics, and payload-protection reversal (see
 * `dlq.provider.ts`'s own `toEntry`). Interposing a repository here would only forward calls to
 * `DLQProvider` unchanged, so this service delegates straight to it instead.
 *
 * **Deliberately exposes only a subset of `DLQProvider`'s methods.** `push`/`get`/`list`/
 * `requeue`/`discard`/`remove` are genuine admin/operator actions — register a failure, inspect
 * one or many entries, force a retry, permanently close one, delete one — the kind of thing a
 * human drives from a REST admin panel.
 *
 * `claim`/`release`/`complete`/`fail` are intentionally NOT exposed here: they're lease-based
 * primitives fenced by a `leaseOwner` a specific worker process holds (see `docs/dlq.md`'s
 * "Concurrency" section), built for `@zanix/asyncmq/dlq`'s `registerDLQProcessor` — or any other
 * automated consumer — to drive programmatically, not for an admin to click a button for. An
 * operator has no real lease to present, so exposing these here would either require faking a
 * `leaseOwner` (which can then collide with, or forcibly interrupt, a genuine in-flight worker's
 * own claim — exactly the interference `leaseOwner` fencing exists to prevent) or bypass the
 * fencing entirely, both worse than simply not exposing them. A caller that genuinely needs these
 * (a worker, not an admin) resolves `DLQProvider` directly via `this.providers.get(DLQProvider)`.
 */
@Interactor()
export class DLQAdminService extends ZanixInteractor {
  /** The provider this service delegates every method to — see this class's own doc for why no
   * separate repository layer sits between them. */
  private get provider(): DLQProvider {
    return this.providers.get(DLQProvider)
  }

  /** See {@link DLQProvider.push}. */
  public push(input: DLQPushInput): Promise<DLQEntryAttrs> {
    return this.provider.push(input)
  }

  /** See {@link DLQProvider.get}. */
  public get(id: string): Promise<DLQEntryAttrs> {
    return this.provider.get(id)
  }

  /** See {@link DLQProvider.list}. */
  public list(options?: DLQListOptions): Promise<DLQPaginatedResult> {
    return this.provider.list(options)
  }

  /** See {@link DLQProvider.requeue}. */
  public requeue(id: string, options?: DLQRequeueOptions): Promise<DLQEntryAttrs> {
    return this.provider.requeue(id, options)
  }

  /** See {@link DLQProvider.discard}. */
  public discard(id: string, options?: DLQDiscardOptions): Promise<DLQEntryAttrs> {
    return this.provider.discard(id, options)
  }

  /** See {@link DLQProvider.remove}. */
  public remove(id: string): Promise<void> {
    return this.provider.remove(id)
  }
}
