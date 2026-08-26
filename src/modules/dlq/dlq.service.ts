import type {
  DlqDiscardOptions,
  DlqEntryAttrs,
  DlqListOptions,
  DlqPushInput,
  DlqRequeueOptions,
} from './dlq.typings.ts'
import type { DlqPaginatedResult } from './dlq.provider.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { DlqProvider } from './dlq.provider.ts'

/**
 * Business logic behind this package's own local `/admin/dlq` — see
 * `./dlq-api/local-dlq.handler.ts`'s `createDlqAdminController`.
 *
 * Unlike `TriggersAdminService` (which delegates to a separate `TriggersAdminRepository`),
 * `DlqProvider` already IS the data-access layer for this collection — it directly owns the Mongo
 * model, the `HttpError('NOT_FOUND'/'CONFLICT')` semantics, and payload-protection reversal (see
 * `dlq.provider.ts`'s own `toEntry`). Interposing a repository here would only forward calls to
 * `DlqProvider` unchanged, so this service delegates straight to it instead.
 *
 * **Deliberately exposes only a subset of `DlqProvider`'s methods.** `push`/`get`/`list`/
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
 * (a worker, not an admin) resolves `DlqProvider` directly via `this.providers.get(DlqProvider)`.
 */
@Interactor()
export class DlqAdminService extends ZanixInteractor {
  /** The provider this service delegates every method to — see this class's own doc for why no
   * separate repository layer sits between them. */
  private get provider(): DlqProvider {
    return this.providers.get(DlqProvider)
  }

  /** See {@link DlqProvider.push}. */
  public push(input: DlqPushInput): Promise<DlqEntryAttrs> {
    return this.provider.push(input)
  }

  /** See {@link DlqProvider.get}. */
  public get(id: string): Promise<DlqEntryAttrs> {
    return this.provider.get(id)
  }

  /** See {@link DlqProvider.list}. */
  public list(options?: DlqListOptions): Promise<DlqPaginatedResult> {
    return this.provider.list(options)
  }

  /** See {@link DlqProvider.requeue}. */
  public requeue(id: string, options?: DlqRequeueOptions): Promise<DlqEntryAttrs> {
    return this.provider.requeue(id, options)
  }

  /** See {@link DlqProvider.discard}. */
  public discard(id: string, options?: DlqDiscardOptions): Promise<DlqEntryAttrs> {
    return this.provider.discard(id, options)
  }

  /** See {@link DlqProvider.remove}. */
  public remove(id: string): Promise<void> {
    return this.provider.remove(id)
  }
}
