import type { DatabaseTypes } from 'database/typings/general.ts'
import { ProgramContainer, type Seeders } from '@zanix/server'

/**
 * A container for holding and managing seeders.
 */
export class SeedersContainer extends ProgramContainer {
  #key = (type: DatabaseTypes) => `${type}:db-seeders`

  /**
   * Add seeder data
   */
  public addSeeder<T extends Seeders[0] = Seeders[0]>(
    seeder: T,
    type: DatabaseTypes = 'mongo',
    container: object = this,
  ) {
    const key = this.#key(type)
    const seeders = this.getSeeders()
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
   * delete all seeders data by db type
   */
  public deleteSeeders(type: DatabaseTypes = 'mongo', container: object = this): void {
    const key = this.#key(type)
    return this.deleteData(key, container)
  }
}
