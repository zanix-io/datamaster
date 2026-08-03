import type { DatabaseTypes } from 'database/typings/general.ts'
import { ProgramContainer, type Seeders } from '@zanix/server'
import { readConfig } from '@zanix/helpers'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/**
 * A container for holding and managing seeders.
 *
 * Namespaced by `(type, connectorKey)` — `connectorKey` defaults to {@link DEFAULT_CONNECTOR_KEY}
 * for the same reason `ModelsContainer` does (see its doc).
 */
export class SeedersContainer extends ProgramContainer {
  public existInDB: Set<string> = new Set()

  #key = (type: DatabaseTypes, connectorKey: string) => `${type}:${connectorKey}:db-seeders`
  #keyData = (type: DatabaseTypes, connectorKey: string, action: string) =>
    `${type}:${connectorKey}:data-${action}-seeders`

  /**
   * Add seeder data
   */
  public addSeeder<T extends Seeders[0] = Seeders[0]>(
    seeder: T,
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ) {
    const key = this.#key(type, connectorKey)
    const seeders = this.getSeeders(type, connectorKey, container)
    seeders.push(seeder)
    this.setData(key, seeders, container)
  }

  /**
   * get seeder data
   */
  public getSeeders<T extends Seeders = Seeders>(
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ): T {
    const key = this.#key(type, connectorKey)
    return this.getData<T>(key, container) || []
  }

  /**
   * add seeder data to query
   */
  public addDataToQuery(options: {
    data: object
    action: 'save' | 'find'
    database?: string
    type?: DatabaseTypes
    connectorKey?: string
  }, container: object = this) {
    const {
      data,
      action,
      database = 'default',
      type = 'mongo',
      connectorKey = DEFAULT_CONNECTOR_KEY,
    } = options
    const key = this.#keyData(type, connectorKey, action)
    const seeders = this.consumeDataToQuery(action, type, connectorKey, container)

    if (database !== 'default') Object.assign(data, { 'executedBy': readConfig().name })

    seeders[database] = [...(seeders[database] || []), data]
    this.setData(key, seeders, container)
  }

  /**
   * get seeder data to query and reset it
   */
  public consumeDataToQuery(
    action: 'save' | 'find',
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ) {
    const key = this.#keyData(type, connectorKey, action)
    const data = this.getData<Record<string, unknown[]>>(key, container) || {}
    this.deleteData(key, container)
    return data
  }

  /**
   * delete all seeders data by db type, scoped to a single connector's bucket
   */
  public deleteSeeders(
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
    container: object = this,
  ): void {
    const key = this.#key(type, connectorKey)
    return this.deleteData(key, container)
  }
}
