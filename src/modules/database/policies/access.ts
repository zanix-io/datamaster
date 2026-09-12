import type { SchemaAccessor } from 'database/typings/general.ts'
import type {
  ConditionalDataAccessConfig,
  DataAccessConfig,
  DataFieldAccess,
} from 'typings/protection.ts'

import { ProgramModule, type Session } from '@zanix/server'
import Program from 'modules/program/mod.ts'
import { mask } from '@zanix/helpers'
import logger from '@zanix/logger'

/**
 * Context needed to resolve the 'conditional' access strategy: the document the field belongs to
 * and the field's own dot-notated path. Both come from wherever the policy is applied (a schema
 * getter, or the `toJSON`/`toObject` transform) — see `dataAccessGetter`/`transformByDataAccess`.
 */
export type DataAccessContext = {
  /** The document (or subdocument scope) the field belongs to. */
  // deno-lint-ignore no-explicit-any
  doc?: Record<string, any>
  /** The field's own dot-notated path, passed through to a 'conditional' strategy's `resolveGrant`. */
  path?: string
}

/**
 * Define the access policy for a data field, applying the given options and an optional value.
 *
 * @param {DataAccessConfig} options - The access policy definition for the data field. This object defines
 *                                    the permissions or rules to be applied to the field.
 * @param {string|string[]} [value] - An optional value or array of values to be set for the data field.
 *                                    If provided, these values will be modified according to the access policy.
 *                                    Defaults to `undefined` if not provided.
 * @param {Session} [session] - The optional session context. If not provided it use ALS.
 * @param {DataAccessContext} [context] - The document/path context a 'conditional' strategy needs to
 *                                    find the field's owner and, if the viewer isn't the owner, call
 *                                    its `resolveGrant`. Unused by every other strategy.
 *
 * @returns {undefined|string|string[]} The modified value or values after applying the access policy.
 *                            If no value is provided, the function may return `undefined`.
 */
export function dataAccessGetterDefinition(
  options: DataAccessConfig,
  value?: string | string[],
  session?: Session,
  context?: DataAccessContext,
): undefined | string | string[] {
  if (!value) return

  const { strategy: accessType } = options
  session = session || ProgramModule.asyncContext.getStore()?.session

  if (!session) {
    logger.warn(
      'Data access policies are enabled, but no session was found.',
      {
        code: 'DATA_ACCESS_NO_SESSION',
        meta: {
          suggestion:
            "Set 'userSession' in the toJSON transform options, or enable ALS through the model configuration options if a manual session is not used.",
          policyEnabled: true,
          source: 'zanix',
        },
      },
    )
    return
  }

  const isAnonymous = session.type === 'anonymous'

  const shouldRemove = accessType === 'internal' ||
    (accessType === 'private' && isAnonymous) ||
    (accessType === 'conditional' && isAnonymous)

  if (shouldRemove) return

  if (options.strategy === 'conditional') {
    return resolveConditionalAccess(options, value, session, context)
  }

  if (isAnonymous && options.strategy === 'protected') {
    value = mask(value, '*', { ...options.settings?.virtualMask, algorithm: 'hard' })
  }

  return value
}

/**
 * Resolves the 'conditional' access strategy for an authenticated, non-anonymous session: the
 * field's owner always sees it; any other viewer only does when `resolveGrant` approves them.
 *
 * `resolveGrant` is called synchronously and must return a plain `boolean` — Mongoose's own
 * getter application (and this package's schema-level `toJSON`/`toObject` transform pipeline)
 * never awaits a transform's result, so a grant check backed by a live lookup (a database query,
 * a remote call, ...) needs to happen ahead of time, with `resolveGrant` reading its outcome from
 * an already-populated, request-scoped cache instead of performing it inline.
 */
function resolveConditionalAccess(
  options: ConditionalDataAccessConfig,
  value: string | string[],
  session: Session,
  context?: DataAccessContext,
): undefined | string | string[] {
  const { ownerField = 'userId', resolveGrant } = options.settings ?? {}
  const { doc, path: field } = context ?? {}

  if (!doc) {
    // No document scope reached this call. `dataAccessGetter`/`dataPoliciesGetter` thread it
    // through automatically, and so does `transformByDataAccess` (the toJSON/toObject transform);
    // this only fires for a direct `dataAccessGetterDefinition` call site that skips them. Fails
    // closed rather than guessing at who owns the field.
    logger.warn(
      'The conditional data access strategy needs the document owning the field, and none was ' +
        'provided.',
      {
        code: 'DATA_ACCESS_CONDITIONAL_NO_CONTEXT',
        meta: { policyEnabled: true, source: 'zanix' },
      },
    )
    return
  }

  const viewerId = session.subject ?? session.id
  const ownerId = doc[ownerField]

  if (ownerId !== undefined && String(ownerId) === String(viewerId)) return value

  if (!resolveGrant) return

  const granted = resolveGrant({
    documentId: doc._id ?? doc.id,
    viewerId: String(viewerId),
    field: field ?? '',
  })

  return granted ? value : undefined
}

/**
 * Set the access policy for a given data field (string or string array), applying the specified base getter function.
 *
 * ⚠️ This function requires context to work correctly.
 * You can achieve this either by activating AsyncLocalStorage (ALS) in the controller or handler and configuring the connector with useALS: true,
 * or by including the user session (userSession property) when performing the toJSON transformation.
 *
 * @param {DataFieldAccess} access - The access policy for the data field. This defines the
 *                                  rules or permissions associated with the field.
 * @param {SchemaAccessor} [baseGetter=(v) => v] - The base getter function to modify the field value.
 *                                               It is a function that accepts a value and returns the modified value.
 *                                               Defaults to an identity function if not provided.
 *
 * @returns {SchemaAccessor} A new schema accessor function that incorporates the given access policy and base getter.
 *
 * ---
 * ### 🧩 Example
 *
 * ```ts
 * const privateFieldGetter = dataAccessGetter('private')
 *
 * const result = privateFieldGetter(fieldValue) // undefine or available if user is authenticated
 * ```
 *
 * @getter
 */
export function dataAccessGetter(
  this: void,
  access: DataFieldAccess,
  baseGetter: SchemaAccessor = (v) => v,
): SchemaAccessor {
  if (typeof this === 'object') {
    logger.warn(
      'An access policy getter definition (dataAccessGetter) is incorrectly implemented and needs to be reviewed.',
      'noSave',
    )

    return access as unknown as SchemaAccessor
  }

  // A `function` (not an arrow) so Mongoose's own getter invocation (`getter.call(scope, value,
  // schemaType)`) binds `this` to the document/subdocument scope — the 'conditional' strategy
  // needs it to find the field's owner. `options` is the Mongoose SchemaType instance, whose
  // `path` is this field's own dot-notated path.
  const accessor: SchemaAccessor = function (this: Record<string, unknown>, value, options) {
    const processedValue = baseGetter(value, options)

    return dataAccessGetterDefinition(dataAccess, processedValue, undefined, {
      doc: this,
      path: options?.path,
    })
  }

  const dataAccess = (typeof access === 'string') ? { strategy: access } : access
  Program.accessors.setDataAccess(accessor, dataAccess)

  return accessor
}
