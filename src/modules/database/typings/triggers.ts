import type { HttpMethod } from '@zanix/server'

// TODO: IMPLEMENT TRIGGERS WHEN WORKER WILL BE DEVELOPED

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
  /** Email action with template. */
  mail: Partial<TriggerActionCommons> & { template: string }
  /** HTTP request action. */
  request: Partial<TriggerActionCommons> & {
    /** HTTP headers to send with the request. */
    headers: Record<string, unknown>
    /** The URL to send the request to. */
    url: string
    /** The HTTP method to use for the request. */
    method: HttpMethod
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
