import type { CreateTriggerInput, TriggersModelAttrs, UpdateTriggerInput } from 'database/mod.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { TriggersAdminRepository } from './triggers.repository.ts'

/**
 * Business logic behind a business service's own local `/admin/triggers` — see
 * `@zanix/admin`'s `createTriggersAdminController`, the composer that wires this into an HTTP
 * surface. Distinct from `@zanix/admin`'s own `/triggers` (a proxy/aggregator over N services) —
 * this one owns real persisted data directly, via {@link TriggersAdminRepository}.
 */
@Interactor()
export class TriggersAdminService extends ZanixInteractor {
  /** The repository this service delegates every method to. */
  private get repository(): TriggersAdminRepository {
    return this.providers.get(TriggersAdminRepository)
  }

  /** See {@link TriggersAdminRepository.list}. */
  public list(): Promise<TriggersModelAttrs[]> {
    return this.repository.list()
  }

  /** See {@link TriggersAdminRepository.get}. */
  public get(model: string): Promise<TriggersModelAttrs> {
    return this.repository.get(model)
  }

  /** See {@link TriggersAdminRepository.create}. */
  public create(input: CreateTriggerInput): Promise<TriggersModelAttrs> {
    return this.repository.create(input)
  }

  /** See {@link TriggersAdminRepository.update}. */
  public update(
    model: string,
    changes: UpdateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    return this.repository.update(model, changes)
  }

  /** See {@link TriggersAdminRepository.remove}. */
  public remove(model: string): Promise<void> {
    return this.repository.remove(model)
  }
}
