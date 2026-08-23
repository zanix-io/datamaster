import type { MongoModelDefinition } from 'mongo/typings/models.ts'
import type { MongoSchemaDefinition } from 'mongo/typings/schema.ts'
import type { DLQEntryAttrs } from './dlq.typings.ts'
import type { EncryptSettings } from 'typings/protection.ts'

import { registerModel } from 'database/defs/models.ts'
import { dataProtectionGetter } from 'database/policies/protection.ts'

/** Env var naming the DLQ collection, in place of {@link RegisterDLQModelOptions}. Also settable
 * from `@zanix/core`'s `Zanix.setup({ dlq: { modelName } })`, mirroring `TRIGGERS_MODEL_NAME`. */
export const DLQ_MODEL_ENV = 'DLQ_MODEL_NAME'
/** Env var toggling `payloadRaw` encryption — `'true'`/`'false'`. Always wins over
 * {@link RegisterDLQModelOptions.encryptPayload} when set, so an environment can force the
 * behavior without a code change. */
export const DLQ_ENCRYPT_PAYLOAD_ENV = 'DLQ_ENCRYPT_PAYLOAD'
/** Env var for the default `claim()` lease duration, in ms. An explicit `claim({ leaseTtlMs })`
 * per call always wins over this. */
export const DLQ_DEFAULT_LEASE_MS_ENV = 'DLQ_DEFAULT_LEASE_MS'

/** Default DLQ collection name when `DLQ_MODEL_NAME` isn't set. */
export const DEFAULT_DLQ_MODEL = 'zanix-dlq'

/**
 * Whether the DLQ resource is configured in this deployment — `true` once `DLQ_MODEL_NAME` is set,
 * the deployment's own opt-in signal (this model has no auto-registration to check instead — see
 * {@link registerDLQModel}'s own doc). Doesn't guarantee `registerDLQModel()` was actually called:
 * env var presence alone can't know that, and this package exposes no stronger "was it registered"
 * query yet — a known, documented gap (`@zanix/admin`'s own `metadata.ts` mirrors this exact
 * signal for its `/admin/dlq` REST gating, inheriting the same limitation rather than a new one).
 */
export const isDlqResourceEnabled = (): boolean => !!Deno.env.get(DLQ_MODEL_ENV)
/** Default `claim()` lease duration (ms) when neither a per-call option nor
 * `DLQ_DEFAULT_LEASE_MS` is set. */
const DEFAULT_LEASE_MS = 30_000

/**
 * What the most recent `registerDLQModel()` call was given for `modelName`/`defaultLeaseMs` —
 * `undefined` for whichever option that call omitted. `registerDLQModel` is the *only* place that
 * writes these (never `dlqModelName`/`defaultLeaseTtlMs` themselves), so there's exactly one source
 * of truth to drift from — unlike a naive per-call-site cache, calling `registerDLQModel()` again
 * (e.g. once per test, or once per connector) always reflects that exact call's own options, never
 * a stale value left over from an earlier one.
 */
let registeredModelName: string | undefined
let registeredDefaultLeaseMs: number | undefined

/**
 * Resolves the effective DLQ collection name: `DLQ_MODEL_NAME` always wins when set (same
 * precedence as {@link RegisterDLQModelOptions.encryptPayload}), then `registerDLQModel`'s own
 * `modelName` option, then the built-in default. Requires `registerDLQModel()` to have already run
 * for the `modelName` option to have taken effect — see that function's own doc.
 */
export const dlqModelName = (): string =>
  Deno.env.get(DLQ_MODEL_ENV) || registeredModelName || DEFAULT_DLQ_MODEL

/**
 * Resolves the default `claim()` lease duration (ms): a per-call `leaseTtlMs` always wins over all
 * of this, then `DLQ_DEFAULT_LEASE_MS`, then `registerDLQModel`'s own `defaultLeaseMs` option, then
 * the built-in 30s default. An invalid/non-positive env value falls back the same way a missing one
 * would, rather than throwing.
 */
export const defaultLeaseTtlMs = (): number => {
  const fromEnv = Deno.env.get(DLQ_DEFAULT_LEASE_MS_ENV)
  if (fromEnv !== undefined) {
    const parsed = Number(fromEnv)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return registeredDefaultLeaseMs ?? DEFAULT_LEASE_MS
}

export type RegisterDLQModelOptions = {
  /**
   * Overrides the DLQ collection name for this registration — `zanix-dlq` otherwise. `DLQ_MODEL_NAME`,
   * when set, always wins over this (same precedence as {@link encryptPayload}), so an environment
   * can force the name without a code change.
   */
  modelName?: string
  /**
   * Overrides the default `claim()` lease duration (ms) for this registration — 30s otherwise. A
   * per-call `claim({ leaseTtlMs })` always wins over this; `DLQ_DEFAULT_LEASE_MS`, when set, wins
   * over both.
   */
  defaultLeaseMs?: number
  /**
   * Encrypts the persisted payload using the existing `encrypt` data-protection strategy — `true`
   * is shorthand for `{ type: 'symmetric' }`. Off by default: a DLQ payload is, by nature, "whatever
   * failed," which often carries internal/PII data, but forcing encryption/key-management on every
   * consumer isn't appropriate either — see `docs/dlq.md`'s "Protecting the payload" section.
   *
   * `DLQ_ENCRYPT_PAYLOAD` (`'true'`/`'false'`), when set, always overrides this option — lets an
   * environment force the behavior without touching code.
   *
   * Changes the schema shape, not just a runtime flag: **off** (the default), `payload` is a native
   * `Mixed` field — full Mongo queryability, including dot-notation into sub-fields
   * (`{'payload.orderId': 'x'}`). **On**, `payload` is stored as a JSON-serialized, encrypted string
   * (`payloadRaw`) instead — the underlying `encrypt`/`decrypt` primitives (`utils/protection.ts`)
   * only operate on `string | string[]`, so a `Mixed` field can't use them directly. `DLQProvider`
   * handles both shapes transparently (`push`/`get`/`list` always expose `payload` as a plain
   * value); only the storage layer differs.
   *
   * Ignored when {@link payloadFields} is given — see that option for protecting only *some*
   * payload leaves while keeping the rest queryable, instead of this all-or-nothing blob encryption.
   */
  encryptPayload?: boolean | EncryptSettings
  /**
   * Declares `payload`'s own field shape instead of leaving it a dynamic `Mixed` value — the same
   * `{ field: { type, get, ... } }` shape as `registerModel`'s own top-level `definition`, so
   * individual fields can be protected in place (`get: dataProtectionGetter(...)`/
   * `dataAccessGetter(...)`) while every other field stays queryable, unlike {@link encryptPayload}'s
   * all-or-nothing blob encryption. Takes priority over `encryptPayload` when both are given —
   * `encryptPayload` is a shorthand for the common "no structure to declare, just encrypt the whole
   * thing" case; once you're declaring structure anyway, protect the specific fields that need it
   * directly instead.
   *
   * @example
   * ```ts
   * import { dataProtectionGetter } from '@zanix/datamaster/database'
   *
   * registerDLQModel({
   *   payloadFields: {
   *     orderId: { type: String }, // stays queryable, unprotected
   *     creditCard: { type: String, get: dataProtectionGetter('encrypt') }, // protected, this leaf only
   *   },
   * })
   * ```
   */
  payloadFields?: MongoSchemaDefinition<Record<string, unknown>>
}

/** Resolves whether/how to protect `payloadRaw`, applying the env-var-wins-over-option precedence
 * documented on {@link RegisterDLQModelOptions.encryptPayload}. */
const resolveEncryptPayload = (
  explicit?: boolean | EncryptSettings,
): EncryptSettings | false => {
  const fromEnv = Deno.env.get(DLQ_ENCRYPT_PAYLOAD_ENV)
  const enabled = fromEnv === undefined ? Boolean(explicit) : fromEnv === 'true'
  if (!enabled) return false
  return typeof explicit === 'object' ? explicit : { type: 'symmetric' }
}

/**
 * Registers `@zanix/datamaster`'s own DLQ model (`zanix-dlq` by default, or `DLQ_MODEL_NAME`/
 * {@link RegisterDLQModelOptions.modelName}) — required once, in the app's own bootstrap, before
 * `DLQProvider` can resolve it (mirrors `registerModel`'s own usage — nothing auto-registers this
 * as a side effect of importing `DLQProvider`, to avoid double-registration risk for
 * multi-connector apps). Registration itself isn't optional — Mongoose needs a concrete schema for
 * the collection before any query against it will work — but *how* it's named/tuned is: through
 * this call's own `options`, or through the env vars, whichever fits the deployment.
 *
 * Also the sole place `modelName`/`defaultLeaseMs` are recorded for `dlqModelName()`/
 * `defaultLeaseTtlMs()` to later resolve (see those functions) — so a call that omits one of them
 * clears any value a *previous* call in the same process had set, rather than leaving it stale.
 * This is safe specifically because this function is the only writer of that state; nothing else
 * needs to agree with it independently.
 *
 * @param connector - An already-`@Connector`-decorated class for a non-default Mongo connector.
 * Omit for the default connector — see `registerModel`'s own `connector` parameter.
 * @param options - See {@link RegisterDLQModelOptions}.
 *
 * @example
 * ```ts
 * import { registerDLQModel } from '@zanix/datamaster'
 *
 * registerDLQModel() // default connector, no payload encryption
 * registerDLQModel({ encryptPayload: true })
 * registerDLQModel({ modelName: 'app-dlq', defaultLeaseMs: 60_000 })
 * ```
 */
export const registerDLQModel = (
  options: RegisterDLQModelOptions = {},
  // deno-lint-ignore ban-types
  connector: Function | undefined = undefined,
): void => {
  registeredModelName = options.modelName
  registeredDefaultLeaseMs = options.defaultLeaseMs
  const encryptPayload = resolveEncryptPayload(options.encryptPayload)

  const definition: MongoModelDefinition<DLQEntryAttrs>['definition'] = {
    processType: { type: String, required: true },
    origin: { type: String, required: true },
    processId: { type: String },
    // A declared `payloadFields` subdocument (individually protectable per-field); else native
    // `Mixed` (fully queryable) when unencrypted; else a protected JSON string when encrypted — see
    // `RegisterDLQModelOptions`'s own docs on `payloadFields`/`encryptPayload` for the full
    // rationale. `DLQProvider` duck-types on which of `payload`/`payloadRaw` Mongoose actually
    // persisted (strict-mode schema binding silently drops whichever field isn't declared here), so
    // it never needs to resolve this configuration independently and can't drift from what this
    // schema actually did.
    ...(options.payloadFields ? { payload: options.payloadFields } : encryptPayload
      ? {
        payloadRaw: {
          type: String,
          required: true,
          get: dataProtectionGetter({
            strategy: 'encrypt',
            settings: encryptPayload,
          }),
        },
      }
      : {
        payload: { type: Object },
      }),
    error: {
      name: { type: String, required: true },
      message: { type: String, required: true },
      stack: { type: String },
    },
    errorHistory: [{
      name: { type: String, required: true },
      message: { type: String, required: true },
      stack: { type: String },
      occurredAt: { type: Date, required: true },
      attempt: { type: Number, required: true },
    }],
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number },
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'claimed', 'failed', 'completed', 'discarded'],
    },
    leaseOwner: { type: String },
    leaseExpiresAt: { type: Date },
    metadata: { type: Object },
  } as MongoModelDefinition<DLQEntryAttrs>['definition']

  registerModel<DLQEntryAttrs>({
    name: dlqModelName(),
    definition,
    options: { timestamps: true },
    callback: (schema) => {
      // Critical for `claim()`'s atomic eligibility filter — see `dlq.provider.ts`.
      schema.index({ status: 1, leaseExpiresAt: 1 })
      // For `list()`'s common filter shape.
      schema.index({ processType: 1, status: 1 })
      return schema
    },
  }, connector)
}
