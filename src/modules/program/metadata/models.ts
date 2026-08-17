// deno-lint-ignore-file no-explicit-any
import type { DatabaseTypes } from 'database/typings/general.ts'
import type { ModelMetadata } from 'database/typings/models.ts'

import { ProgramContainer } from '@zanix/server'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/** A connector reference registered against a model name, for `findRegisteredConnectors`. */
export type RegisteredConnector = { key: string; connectorName: string }

/**
 * A container for holding and managing models.
 *
 * Namespaced by `(type, connectorKey)` — `connectorKey` defaults to {@link DEFAULT_CONNECTOR_KEY}
 * (`@zanix/datamaster`'s own default Mongo connector) so a single-connector consumer that never
 * passes a `connector` to `registerModel` keeps reading/writing the exact same bucket it always has.
 */
export class ModelsContainer extends ProgramContainer {
  #key = (type: DatabaseTypes, connectorKey: string) => `${type}:${connectorKey}:db-model`
  #indexKey = (type: DatabaseTypes, name: string) => `${type}:model-connector-index:${name}`

  /**
   * Add model data
   */
  public addModel<T = any>(
    model: ModelMetadata<T>,
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    connectorName: string = connectorKey,
    container: object = this,
  ) {
    const key = this.#key(type, connectorKey)
    const models = this.getModels(type, connectorKey, container)
    models.push(model)
    this.setData(key, models, container)

    // Permanent reverse index (a distinct key namespace, never cleared by `deleteModels`) — lets
    // `ZanixMongoConnector.getModel()` distinguish "never registered" from "registered, but for a
    // different connector" when building its error. Deduplicated by `key`.
    const idxKey = this.#indexKey(type, model.name)
    const registered = this.getData<RegisteredConnector[]>(idxKey, container) ||
      []
    if (!registered.some((entry) => entry.key === connectorKey)) {
      registered.push({ key: connectorKey, connectorName })
      this.setData(idxKey, registered, container)
    }
  }

  /**
   * get model data
   */
  public getModels<T = any>(
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ): ModelMetadata<T>[] {
    const key = this.#key(type, connectorKey)
    return this.getData(key, container) || []
  }

  /**
   * delete all models data by db type, scoped to a single connector's bucket
   */
  public deleteModels(
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ): void {
    const key = this.#key(type, connectorKey)
    return this.deleteData(key, container)
  }

  /**
   * Every connector that has ever registered a model named `name` for `type` — survives
   * `deleteModels` (a separate, permanent index). Used by `ZanixMongoConnector.getModel()` to build
   * a specific "registered, but for a different connector" error instead of a generic "not found".
   */
  public findRegisteredConnectors(
    type: DatabaseTypes,
    name: string,
    container: object = this,
  ): RegisteredConnector[] {
    return this.getData<RegisteredConnector[]>(
      this.#indexKey(type, name),
      container,
    ) || []
  }
}
