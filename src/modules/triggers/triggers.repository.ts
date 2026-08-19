import type {
  CreateTriggerInput,
  Model,
  TriggersModelAttrs,
  UpdateTriggerInput,
} from 'database/mod.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { triggersModelName } from 'database/mod.ts'
import type { ZanixMongoConnector } from 'database/mod.ts'

/**
 * Data access for this package's own persisted triggers collection (`zanix-triggers` by default,
 * or `TRIGGERS_MODEL_NAME`). Backs this package's own local `/admin/triggers` API — see
 * `./triggers-api/local-triggers.handler.ts`'s `createTriggersAdminController`. This package owns
 * both the data and the local HTTP surface fronting it; `@zanix/admin` owns a genuinely different
 * concern — cross-service aggregation (`TriggersAggregator`).
 */
@Provider()
export class TriggersAdminRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** Resolves the underlying triggers `Model` once the connector is ready. */
  private async model(): Promise<Model<TriggersModelAttrs>> {
    await this.database.isReady
    return this.database.getModel<TriggersModelAttrs>(triggersModelName())
  }

  /** Returns every persisted trigger configuration entry. */
  public async list(): Promise<TriggersModelAttrs[]> {
    const Model = await this.model()
    return Model.find({})
  }

  /**
   * Returns a single trigger configuration entry.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `model`.
   */
  public async get(model: string): Promise<TriggersModelAttrs> {
    const Model = await this.model()
    const entry = await Model.findOne({ model })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { model } })
    return entry
  }

  /**
   * Creates a new trigger configuration entry.
   *
   * @throws {HttpError} `CONFLICT` if a configuration for `model` already exists.
   */
  public async create(input: CreateTriggerInput): Promise<TriggersModelAttrs> {
    const { model, active, triggers } = input
    const Model = await this.model()
    const existing = await Model.findOne({ model })
    if (existing) {
      throw new HttpError('CONFLICT', {
        meta: {
          model,
          message: `A trigger configuration for model "${model}" already exists.`,
        },
      })
    }
    return Model.create({ model, active, triggers, isDefault: false })
  }

  /**
   * Applies a partial update to an existing entry.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `model`.
   */
  public async update(
    model: string,
    changes: UpdateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    const Model = await this.model()
    const entry = await Model.findOneAndUpdate({ model }, { $set: changes }, {
      new: true,
    })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { model } })
    return entry
  }

  /**
   * Deletes a trigger configuration entry. Note: if the entry is `isDefault: true` (auto-seeded
   * from a model's static `extensions.triggers`), the deletion isn't durable — it gets re-seeded
   * from code the next time the app boots. This is existing behavior, not something this API can
   * or should override.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `model`.
   */
  public async remove(model: string): Promise<void> {
    const Model = await this.model()
    const result = await Model.deleteOne({ model })
    if (!result.deletedCount) {
      throw new HttpError('NOT_FOUND', { meta: { model } })
    }
  }
}
