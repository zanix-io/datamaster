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
   * `to: '{{email}}'`, `subject: 'Welcome {{name}}'`.
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
    body: { template: string; data?: Record<string, unknown> | string }
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
   * `headers: { authorization: 'Bearer {{apiKey}}' }`.
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
