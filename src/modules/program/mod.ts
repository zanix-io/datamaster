import { AccessorsContainer } from './metadata/accessors.ts'
import { ModelsContainer } from './metadata/models.ts'
import { SeedersContainer } from './metadata/seeders.ts'

/**
 * Class that manages internal containers for caching, and databases.
 * Provides methods for cleaning up metadata stored in these containers.
 */
export class InternalProgram {
  /**
   * Target container that stores the models.
   * @type {ModelsContainer}
   */
  public models: ModelsContainer = new ModelsContainer()
  /**
   * Target container that stores the seeders.
   * @type {SeedersContainer}
   */
  public seeders: SeedersContainer = new SeedersContainer()
  /**
   * Target container that stores accessor information
   */
  public accessors: AccessorsContainer = new AccessorsContainer()
}

/**
 * A frozen singleton instance of the `InternalProgram`.
 * @type {Readonly<InternalProgram>}
 */
const ProgramModule: Readonly<InternalProgram> = Object.freeze(new InternalProgram())
export default ProgramModule
