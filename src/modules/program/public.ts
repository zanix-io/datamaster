import type { DatabaseTypes } from 'database/typings/general.ts'
import type { ModelMetadata } from 'database/typings/models.ts'
import type { Seeders } from '@zanix/server'

import ProgramModule from './mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/**
 * Represents the main program interface that can be exported and used by other libraries.
 *
 * This class is intended to provide reusable functionality and act as a shared program module.
 *
 * @exports Program
 */
export class Program {
  /**
   * Retrieves metadata handlers for the specified database type.
   *
   * This method returns an object containing accessors for `models` and `seeders`,
   * which allow consumers to interact with the defined database entities.
   *
   * @param {DatabaseTypes} [type='mongo'] - The type of database to retrieve metadata for.
   * @param {string} [connectorKey] - Which connector's bucket to read — only relevant when your app
   * registers more than one Mongo connector (see `registerModel`'s `connector` param). Defaults to
   * the default connector's key.
   * @returns {{
   *     readonly models: ModelMetadata<any>[];
   *     readonly seeders: Seeders;
   * }} An object containing the models and seeders for the specified database type.
   */
  public getMetadata(
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
  ): {
    // deno-lint-ignore no-explicit-any
    readonly models: ModelMetadata<any>[]
    readonly seeders: Seeders
  } {
    return {
      get models() {
        return ProgramModule.models.getModels(type, connectorKey)
      },
      get seeders() {
        return ProgramModule.seeders.getSeeders(type, connectorKey)
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
   * @param {string} [connectorKey] - Which connector's bucket to delete — see {@link getMetadata}.
   * @returns {void}
   */
  public deleteMetadata(
    meta: 'seeders' | 'models',
    type: DatabaseTypes = 'mongo',
    connectorKey: string = DEFAULT_CONNECTOR_KEY,
  ): void {
    if (meta === 'seeders') {
      ProgramModule.seeders.deleteSeeders(type, connectorKey)
    } else ProgramModule.models.deleteModels(type, connectorKey)
  }
}

/**
 * A frozen singleton instance of the `Program`.
 *
 * This instance provides reusable functionality and serves as a shared module
 * for program metadata and events.
 *
 * @type {Readonly<Program>}
 */
const PublicProgramModule: Readonly<Program> = Object.freeze(new Program())
export default PublicProgramModule
