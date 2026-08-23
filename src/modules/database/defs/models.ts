import type { ModelDef } from 'database/typings/models.ts'

import ProgramModule from 'modules/program/mod.ts'
import { seederAdaptation } from '../utils/seeders/adaptation.ts'
import { DATABASE_SEEDERS_ENV, DEFAULT_CONNECTOR_KEY } from '../utils/constants.ts'
import { getConnectorKey } from '@zanix/server'
import { InternalError } from '@zanix/errors'

/**
 * A DSL definition that adds a model to the `ProgramModule`'s model registry.
 * This function enhances the given model by adding it to a collection or registry of models,
 * optionally specifying the database type (defaulting to `'mongo'`) and the connector it belongs
 * to (defaulting to the default `'database'` connector).
 *
 * @function
 * @param model - The model to be added to the model registry.
 * @param connector - An optional connector class this model is bound to. Only needed when your app
 * registers more than one Mongo connector — see {@link ModelDef}'s doc for the full rationale.
 * @param type - An optional database type that the model is associated with. Defaults to `'mongo'`.
 *
 * @example
 * // Example usage of registerModel
 * const MyModel = {...} as const;
 * registerModel<Attrs>(MyModel);
 *
 * @example
 * // Example usage with MyModel specification — `access`/`protection` are NOT plain field options;
 * // they're applied as Mongoose `get`/`set` functions via `dataAccessGetter`/`dataProtectionGetter`
 * // (both re-exported from `database/mod.ts`). See `docs/data-protection.md` for every strategy.
 * import { dataAccessGetter, dataProtectionGetter, registerModel } from '@zanix/datamaster/database'
 *
 * registerModel({
 *   name: 'test', // supports multi-DB notation: 'database:test' (also valid in population refs)
 *   definition: {
 *     name: {
 *       type: String,
 *       unique: true,
 *       get: dataAccessGetter({ strategy: 'internal' }),
 *     },
 *     description: {
 *       type: String,
 *       get: dataAccessGetter({ strategy: 'private' }),
 *     },
 *     ssn: {
 *       type: String,
 *       get: dataProtectionGetter({ strategy: 'encrypt', settings: { type: 'asymmetric' } }),
 *     },
 *   },
 *   options: {
 *     timestamps: true, // adds `createdAt`/`updatedAt` — prefer this over declaring them by hand
 *   },
 *   callback: (schema) => {
 *     // Additional schema customizations or logic
 *     return schema;
 *   },
 * });
 *
 * @example
 * // Registering a model for a connector other than the default one
 * import { OtherMongoConnector } from '../connectors/other-mongo.connector.ts'
 *
 * registerModel({ name: 'test', definition: {...} }, OtherMongoConnector);
 */
export const registerModel: ModelDef = (
  { extensions = {}, ...model },
  connector,
  type,
): void => {
  if (!type) type = 'mongo' as never

  const connectorKey = connector ? getConnectorKey(connector) : DEFAULT_CONNECTOR_KEY
  if (connector && !connectorKey) {
    throw new InternalError(
      `Cannot register model "${model.name}" for connector "${connector.name}": it hasn't been ` +
        `decorated with @Connector yet. Import/decorate it before calling registerModel with it.`,
      {
        meta: { source: 'zanix', model: model.name, connector: connector.name },
      },
    )
  }
  const connectorName = connector?.name ?? DEFAULT_CONNECTOR_KEY

  const { seeders = [], ...exts } = extensions

  ProgramModule.models.addModel(
    { ...model, extensions: exts },
    type,
    connectorKey,
    connectorName,
  )

  if (!seeders.length || Deno.env.get(DATABASE_SEEDERS_ENV) === 'false') return

  ProgramModule.seeders.addSeeder(
    {
      model: type === 'mongo' ? model.name : model,
      handlers: seederAdaptation(seeders, model, type, connectorKey),
    },
    type,
    connectorKey,
  )
}
