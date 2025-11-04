import type { DatabaseTypes } from 'database/typings/general.ts'
import type { ModelMetadata } from 'database/typings/models.ts'
import type { Seeders } from '@zanix/server'

import ProgramModule from './mod.ts'

/**
 * Represents the main program interface that can be exported and used by other libraries.
 *
 * This class is intended to provide reusable functionality and act as a shared program module.
 *
 * @exports Program
 */
class Program {
  /**
   * Retrieves metadata handlers for the specified database type.
   *
   * This method returns an object containing accessors for `models` and `seeders`,
   * which allow consumers to interact with the defined database entities.
   *
   * @param {DatabaseTypes} [type='mongo'] - The type of database to retrieve metadata for.
   * @returns {{
   *     readonly models: ModelMetadata<any>[];
   *     readonly seeders: Seeders;
   * }} An object containing the models and seeders for the specified database type.
   */
  public getMetadata(type: DatabaseTypes = 'mongo'): {
    // deno-lint-ignore no-explicit-any
    readonly models: ModelMetadata<any>[]
    readonly seeders: Seeders
  } {
    return {
      get models() {
        return ProgramModule.models.getModels(type)
      },
      get seeders() {
        return ProgramModule.seeders.getSeeders(type)
      },
    }
  }

  /**
   * Deletes metadata of the specified type (`models` or `seeders`) for the given database type.
   *
   * This method allows cleanup or reinitialization of metadata for a specific database.
   *
   * @param {'seeders' | 'models'} meta - The type of metadata to delete.
   * @param {DatabaseTypes} [type='mongo'] - The type of database from which to delete metadata.
   * @returns {void}
   */
  public deleteMetadata(meta: 'seeders' | 'models', type: DatabaseTypes = 'mongo'): void {
    if (meta === 'seeders') ProgramModule.seeders.deleteSeeders(type)
    else ProgramModule.models.deleteModels(type)
  }
}

/**
 * A frozen singleton instance of the `Program`,
 * to provide reusable functionality and act as a shared metadata program module.
 *
 * @type {Readonly<Program>}
 */
const PublicProgramModule: Readonly<Program> = Object.freeze(new Program())
export default PublicProgramModule
