// deno-lint-ignore-file no-explicit-any
import type { TriggerActionCommons, TriggerActions } from 'database/typings/triggers.ts'
import type { BuiltInTriggerActionType } from 'database/defs/trigger-actions.ts'
import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'
import { ProgramModule as ServerProgram, type ZanixWorkerProvider } from '@zanix/server'
import { interpolate, interpolateEnv, interpolateUrl, toSearchParams } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import ProgramModule from 'modules/program/mod.ts'
import { validateConditions } from './conditions.ts'

type TriggerActionType = keyof TriggerActions
type TriggerActionConfig<T extends TriggerActionType> =
  & Partial<TriggerActionCommons>
  & TriggerActions[T]

/**
 * HTTP methods that conventionally carry no request body. A `request` action's `body` is
 * converted into query parameters (via `@zanix/helpers`'s `toSearchParams`, appended to `url`)
 * instead of being sent as a fetch body for these — many servers ignore or reject a body on
 * these methods, so sending it as query parameters is what actually reaches the endpoint.
 */
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE'])

/**
 * Resolves the job name `type` dispatches to: `custom` always carries its own job name inline;
 * every other action kind resolves through `ProgramModule.triggerActionJobs` (populated via
 * `registerTriggerActionJob` — see `database/defs/trigger-actions.ts`), falling back to
 * {@link DEFAULT_TRIGGER_JOBS}'s literal defaults for `mail`/`request` if nothing registered an
 * override. A future built-in-like action kind with no registration and no default throws instead
 * of dispatching to `undefined`.
 */
const jobNameFor = <T extends TriggerActionType>(
  type: T,
  action: TriggerActionConfig<T>,
): string => {
  if (type === 'custom') return (action as TriggerActionConfig<'custom'>).name

  const builtInType = type as BuiltInTriggerActionType
  const registered = ProgramModule.triggerActionJobs.resolve(builtInType)
  if (registered) return registered.name

  if (builtInType === 'mail' || builtInType === 'request') {
    return DEFAULT_TRIGGER_JOBS[builtInType]
  }

  throw new InternalError(
    `No job registered for trigger action "${builtInType}". Call registerTriggerActionJob("${builtInType}", jobName) before dispatching it.`,
  )
}

const dispatchAction = async <T extends TriggerActionType>(
  type: T,
  action: TriggerActionConfig<T>,
  data: any,
): Promise<void> => {
  const { conditions, priority, delay, ...actionFields } = action

  if (conditions && !validateConditions(data, conditions)) return

  const oldData = data?._old
  const { _old, ...currentData } = data ?? {}

  const worker = ServerProgram.providers.get<ZanixWorkerProvider>('worker')
  const contextId = ServerProgram.asyncContext.getStore()?.id
  const jobName = jobNameFor(type, action)

  // Every field on the action (`to`, `subject`, `url`, `headers`, `body`, `data`, and any field
  // added later) supports `{{field}}`/`{{nested.path}}` placeholders, resolved recursively against
  // the record the trigger fired for — this is the ONLY way action fields see per-record data;
  // nothing is merged in automatically beyond what a field's own placeholders resolve to. `data` is
  // deliberately kept inside this generic pass (not pulled out early) so a field added to
  // `TriggerActionCommons` in the future is covered without touching this function. `url` is the
  // one deliberate exception — it gets its own query-string-aware interpolation (see
  // `interpolateUrl`) instead of the generic pass, so an array/object whole-value placeholder in a
  // query param expands correctly.
  const { url: rawUrl, ...restFields } = actionFields as
    & { url?: string }
    & Record<string, any>
  const modelInterpolatedFields: any = interpolate(restFields, currentData)
  if (rawUrl !== undefined) {
    modelInterpolatedFields.url = interpolateUrl(rawUrl, currentData)
  }

  // `${{ENV_VAR}}` placeholders (see `interpolateEnv`) are resolved next, against `Deno.env` — a
  // separate pass from the `{{field}}` one above, so secrets never need to be written into the
  // trigger definition itself (see the security note on `TriggerActions`). Runs over every field
  // (including the already-resolved `url` and `data`), so both conventions can coexist in the same
  // string.
  const interpolatedFields: any = interpolateEnv(modelInterpolatedFields)

  // For methods that conventionally carry no body, send `body`'s fields as query parameters
  // instead — see `BODYLESS_METHODS`.
  if (
    type === 'request' && interpolatedFields.body !== undefined &&
    BODYLESS_METHODS.has(interpolatedFields.method)
  ) {
    const queryString = toSearchParams(interpolatedFields.body).toString()
    if (queryString) {
      interpolatedFields.url += (interpolatedFields.url.includes('?') ? '&' : '?') + queryString
    }
    delete interpolatedFields.body
  }

  // `data` merges into the job's own `data` payload (alongside `_data`/`_oldData`) instead of
  // top-level `args` — it's split off only now, after already going through both interpolation
  // passes above like any other field.
  const { data: interpolatedExtraData, _timeout, ...topLevelFields } = interpolatedFields

  const args = {
    type,
    ...topLevelFields,
    priority: priority || 'low',
    delay,
    data: {
      _data: currentData,
      ...(oldData ? { _oldData: oldData } : {}),
      ...interpolatedExtraData,
    },
  }

  // Without AsyncMQ configured (`AMQP_URI`), there's no queue to publish to — run the job locally
  // via `runTask` instead of `runJob`. Same `Deno.env.has(...)` gate this ecosystem already uses to
  // decide whether an optional external service is available (e.g. `REDIS_URI` for the Redis
  // connector, `mongo/connector/core.ts`'s `MONGO_URI` check).
  if (Deno.env.has('AMQP_URI')) {
    await worker.runJob(jobName, {
      contextId,
      args,
      settings: { priority: priority || 'low' },
    })
  } else {
    worker.runTask(jobName, { contextId, args, timeout: _timeout ?? 20_000 })
  }
}

/**
 * Dispatches every action present on a matched trigger (`mail`, `request`, `custom`) for a given
 * document event.
 *
 * Each action's `conditions` are evaluated against `data` first (see {@link validateConditions});
 * actions whose conditions don't pass are skipped. Passing actions go through two interpolation
 * passes, in order:
 *
 * 1. **Model interpolation** — every string field (`to`, `subject`, `headers`, `body`, `data`,
 *    ...) is interpolated against `data` (see {@link interpolate}), recursively through nested
 *    objects/arrays; `url` gets its own query-string-aware interpolation instead (see
 *    {@link interpolateUrl}). This is the only way a field sees per-record data — nothing is
 *    merged in beyond what its own `{{field}}` placeholders resolve to.
 * 2. **Environment interpolation** — every field (including the already-resolved `url` and `data`)
 *    is then interpolated again for `${{ENV_VAR}}` placeholders against `Deno.env` (see
 *    {@link interpolateEnv}). This is how a trigger reaches a secret (an API key, a bearer token,
 *    a webhook URL) **without writing it into the trigger definition itself** — see the security
 *    note on {@link TriggerActions}. The two placeholder conventions coexist in the same string
 *    (e.g. `'Bearer ${{TOKEN}}'` next to a `{{field}}` elsewhere) without either one resolving the
 *    other's placeholders.
 *
 * For `request` actions whose `method` conventionally carries no body (`GET`, `HEAD`, `DELETE`), a
 * configured `body` is converted into query parameters appended to `url` instead of being sent as
 * a fetch body — after both interpolation passes, so an env-resolved value can also be sent this
 * way. Actions are dispatched via `ProgramModule.providers.get('worker')` to their corresponding
 * job name ({@link DEFAULT_TRIGGER_JOBS} for `mail`/`request`, or the action's own `name` for
 * `custom`) — via `runJob` (queue-backed) when `AMQP_URI` is configured, or `runTask` (local,
 * in-process) when it isn't, since there's no queue to publish to in that case.
 *
 * @param data - The document (or plain payload) the trigger fired for. If it carries an `_old`
 * property (the pre-change document, for `updated`/`deleted` events), it's forwarded to the job
 * as `_oldData` and stripped from the current-data payload.
 * @param trigger - The set of actions configured for this event.
 */
export const handleTrigger = async (
  data: any,
  trigger: Partial<TriggerActions>,
): Promise<void> => {
  const types = Object.keys(trigger) as TriggerActionType[]

  await Promise.all(
    types.map((type) => {
      const action = trigger[type]
      if (!action) return
      return dispatchAction(
        type,
        action as TriggerActionConfig<typeof type>,
        data,
      )
    }),
  )
}
