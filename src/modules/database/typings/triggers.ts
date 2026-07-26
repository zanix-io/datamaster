import type { HttpMethod } from '@zanix/server'

/**
 * Represents a single condition for filtering or matching.
 * @interface SingleCondition
 */
export interface SingleCondition {
  /** The name of the field to evaluate. */
  field: string
  /** The operator to apply. */
  op: '<' | '>' | '=' | '<=' | '>=' | 'includes' | '!='
  /** The value to compare against. */
  value: string | boolean | number | '!$undefined'
}

/**
 * Represents a logical AND condition combining multiple conditions.
 * @interface AndCondition
 */
export interface AndCondition {
  /** An array of conditions all of which must be true. */
  and: Condition[]
}

/**
 * Represents a logical OR condition combining multiple conditions.
 * @interface OrCondition
 */
export interface OrCondition {
  /** An array of conditions where at least one must be true. */
  or: Condition[]
}

/**
 * Represents a logical NOT condition negating multiple conditions.
 * @interface NotCondition
 */
export interface NotCondition {
  /** An array of conditions all of which must be false. */
  not: Condition[]
}

/**
 * A condition which can be a single comparison or a composite logical condition.
 */
export type Condition = SingleCondition | AndCondition | OrCondition | NotCondition

/**
 * Common properties for trigger actions.
 */
export type TriggerActionCommons = {
  /** The priority level of the action. */
  priority: 'high' | 'medium' | 'low'
  /** Delay in milliseconds before the action executes. */
  delay: number
  /** Additional data to pass along with the action. */
  data: Record<string, unknown>
  /** Conditions that must be met for the action to trigger. */
  conditions: Condition[]
}

/**
 * Defines the specific types of trigger actions.
 *
 * > ⚠️ **Security: never hardcode secrets in a trigger definition.** A trigger's fields are
 * > declarative config — they can be read back (e.g. via the persisted triggers collection, a
 * > plain document in the database), so a literal API key, bearer token, password, or other
 * > credential written directly into `headers`, `body`, `url`, or any other field is exposed to
 * > anyone who can read that config, not just whoever executes the trigger. Don't write
 * > `headers: { authorization: 'Bearer sk_live_xxxxx' }` or `password: 'my-secret-password'`.
 * > Instead, reference an environment variable with the `${{VARIABLE_NAME}}` placeholder — e.g.
 * > `headers: { authorization: 'Bearer ${{API_KEY}}' }` — which is resolved automatically from
 * > `Deno.env` (`handleTrigger` in `dispatch.ts`, via `@zanix/helpers`'s `interpolateEnv`) right
 * > before the action executes, **as long as that variable is registered in the environment of
 * > the application where the trigger (or the model/schema that owns it) actually runs**. If the
 * > variable isn't set there, the placeholder resolves to the literal text `'undefined'` rather
 * > than throwing — so a missing variable fails loudly in the dispatched payload, not silently.
 */
export type TriggerActions = {
  /**
   * Email action.
   *
   * Dispatched to the well-known {@link DEFAULT_TRIGGER_JOBS.mail} job — an app bootstrapped via
   * `@zanix/core`'s `Zanix.start()`/`Zanix.startWorker()` gets this registered automatically
   * (`@zanix/core` is the layer that depends on datamaster, asyncmq, and notifications
   * simultaneously, so it — not asyncmq itself — owns this handler), mapping `body` directly onto
   * `NotifyMessageWithTemplate`'s `{ template, data }` shape.
   *
   * Every string field (`to`, `subject`, `body.data`'s own values, ...) supports `{{field}}`/
   * `{{nested.path}}` placeholders, resolved against the record the trigger fired for — e.g.
   * `to: '{{email}}'`, `subject: 'Welcome {{name}}'` — and, separately, `${{ENV_VAR}}`
   * placeholders resolved from `Deno.env` (see the security note on {@link TriggerActions}). Both
   * conventions can coexist in the same field.
   */
  mail: Partial<TriggerActionCommons> & {
    /** The recipient email address. Supports `{{field}}` interpolation. */
    to: string
    /** The email subject line. Supports `{{field}}` interpolation. */
    subject: string
    /** The sender email address. Defaults to whatever the notifier provider configures. */
    from?: string
    /** The message date. Defaults to whatever the notifier provider sets it to. */
    date?: string
    /**
     * The email body: a template reference. `data` is the template's render data — an object of
     * fields the template expects (for templates that support custom styling, a `styles.css` key
     * appends additional CSS to the template's own base stylesheet, concatenated, not replaced),
     * or a literal string for templates that accept plain content directly. String values within
     * `data` support `{{field}}` interpolation, same as any other field.
     */
    body: {
      /** The name of the notification template to render. */
      template: string
      /** The template's render data, or a literal string for plain-content templates. */
      data?: Record<string, unknown> | string
    }
  }
  /**
   * HTTP request action.
   *
   * Dispatched to the well-known {@link DEFAULT_TRIGGER_JOBS.request} job — an app bootstrapped
   * via `@zanix/core`'s `Zanix.start()`/`Zanix.startWorker()` gets this registered automatically
   * with a generic `fetch`-based job.
   *
   * Every string field (`url`, `headers`' values, `body`'s own values, ...) supports `{{field}}`/
   * `{{nested.path}}` placeholders, resolved against the record the trigger fired for — e.g.
   * `headers: { authorization: 'Bearer {{apiKey}}' }` — and, separately, `${{ENV_VAR}}`
   * placeholders resolved from `Deno.env` — e.g. `headers: { authorization: 'Bearer ${{TOKEN}}'
   * }`. **Use `${{ENV_VAR}}` for any credential** (API keys, bearer tokens, webhook secrets)
   * instead of writing it literally — see the security note on {@link TriggerActions}. Both
   * conventions can coexist in the same field.
   */
  request: Partial<TriggerActionCommons> & {
    /** HTTP headers to send with the request. Values support `{{field}}` interpolation. */
    headers: Record<string, unknown>
    /** The URL to send the request to. Supports `{{field}}` interpolation. */
    url: string
    /** The HTTP method to use for the request. */
    method: HttpMethod
    /**
     * The request body. **Nothing is sent automatically** — omit this to send no body at all,
     * even though the trigger fired for a real record; only what's explicitly listed here (with
     * `{{field}}` interpolation applied) is sent.
     */
    body?: Record<string, unknown>
  }
  /**
   * A reference to a custom job, by name, that the consuming app has already registered itself
   * via `@zanix/asyncmq`'s `registerJob` (the same pattern as calling `this.worker.runJob(name,
   * ...)` directly from an interactor). Datamaster only dispatches to this job name — it never
   * registers a handler for it.
   */
  custom: Partial<TriggerActionCommons> & {
    /** The name of the job to dispatch to, as registered via `registerJob`. */
    name: string
  }
}

/**
 * Defines trigger types mapped to arrays of trigger actions.
 * @property {Array<Partial<TriggerActions>>} created - Actions triggered on creation events.
 * @property {Array<Partial<TriggerActions>>} updated - Actions triggered on update events.
 * @property {Array<Partial<TriggerActions>>} deleted - Actions triggered on deletion events.
 */
export type TriggerTypes = Record<
  'created' | 'updated' | 'deleted',
  Array<Partial<TriggerActions>>
>

/**
 * Represents triggers categorized by their timing ('pre' or 'post') and event types.
 * @typedef {Partial<Record<'pre' | 'post', Partial<TriggerTypes>>>} Triggers
 */
export type Triggers = Partial<Record<'pre' | 'post', Partial<TriggerTypes>>>

/**
 * The well-known job names datamaster dispatches built-in trigger actions to via
 * `ProgramModule.providers.get('worker').runJob(...)`.
 *
 * These names are the contract that must have a job handler registered for them (via
 * `registerJob`) in order for `mail`/`request` trigger actions to actually run — apps bootstrapped
 * via `@zanix/core` get this automatically; standalone `@zanix/asyncmq` usage must register them
 * itself. `custom` actions reference their own job name directly instead of one of these.
 */
export const DEFAULT_TRIGGER_JOBS = {
  /** Job name for the built-in `mail` trigger action. */
  mail: 'zanix:trigger:mail',
  /** Job name for the built-in `request` trigger action. */
  request: 'zanix:trigger:request',
} as const
