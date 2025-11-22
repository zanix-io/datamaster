import type { DatabaseTypes } from 'database/typings/general.ts'
import { ProgramContainer, type Seeders } from '@zanix/server'
import { readConfig } from '@zanix/helpers'

/**
 * A container for holding and managing seeders.
 */
export class SeedersContainer extends ProgramContainer {
  public existInDB: Set<string> = new Set()

  #key = (type: DatabaseTypes) => `${type}:db-seeders`
  #keyData = (dbType: DatabaseTypes, action: string) => `${dbType}:data-${action}-seeders`

  /**
   * Add seeder data
   */
  public addSeeder<T extends Seeders[0] = Seeders[0]>(
    seeder: T,
    type: DatabaseTypes = 'mongo',
    container: object = this,
  ) {
    const key = this.#key(type)
    const seeders = this.getSeeders(type)
    seeders.push(seeder)
    this.setData(key, seeders, container)
  }

  /**
   * get seeder data
   */
  public getSeeders<T extends Seeders = Seeders>(
    type: DatabaseTypes = 'mongo',
    container: object = this,
  ): T {
    const key = this.#key(type)
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
  }, container: object = this) {
    const { data, action, database = 'default', type = 'mongo' } = options
    const key = this.#keyData(type, action)
    const seeders = this.consumeDataToQuery(action, type)

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
    container: object = this,
  ) {
    const key = this.#keyData(type, action)
    const data = this.getData<Record<string, unknown[]>>(key, container) || {}
    this.deleteData(key, container)
    return data
  }

  /**
   * delete all seeders data by db type
   */
  public deleteSeeders(type: DatabaseTypes = 'mongo', container: object = this): void {
    const key = this.#key(type)
    return this.deleteData(key, container)
  }
}
