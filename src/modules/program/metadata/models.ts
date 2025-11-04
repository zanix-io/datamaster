// deno-lint-ignore-file no-explicit-any
import type { DatabaseTypes } from 'database/typings/general.ts'
import type { ModelMetadata } from 'database/typings/models.ts'

import { ProgramContainer } from '@zanix/server'

/**
 * A container for holding and managing models.
 */
export class ModelsContainer extends ProgramContainer {
  #key = (type: DatabaseTypes) => `${type}:db-model`

  /**
   * Add model data
   */
  public addModel<T = any>(
    model: ModelMetadata<T>,
    type: DatabaseTypes = 'mongo',
    container: object = this,
  ) {
    const key = this.#key(type)
    const models = this.getModels(type)
    models.push(model)
    this.setData(key, models, container)
  }

  /**
   * get model data
   */
  public getModels<T = any>(
    type: DatabaseTypes = 'mongo',
    container: object = this,
  ): ModelMetadata<T>[] {
    const key = this.#key(type)
    return this.getData(key, container) || []
  }

  /**
   * delete all models data by db type
   */
  public deleteModels(type: DatabaseTypes = 'mongo', container: object = this): void {
    const key = this.#key(type)
    return this.deleteData(key, container)
  }
}
