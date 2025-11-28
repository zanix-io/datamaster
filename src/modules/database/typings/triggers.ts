import type { HttpMethod } from '@zanix/server'

// TODO: IMPLEMENT TRIGGERS WHEN WORKER WILL BE DEVELOPED

/**
 * Represents a single condition for filtering or matching.
 * @interface SingleCondition
 * @property {string} field - The name of the field to evaluate.
 * @property {'<' | '>' | '=' | '<=' | '>=' | 'includes' | '!='} op - The operator to apply.
 * @property {string | boolean | number | '!$undefined'} value - The value to compare against.
 */
interface SingleCondition {
  field: string
  op: '<' | '>' | '=' | '<=' | '>=' | 'includes' | '!='
  value: string | boolean | number | '!$undefined'
}

/**
 * Represents a logical AND condition combining multiple conditions.
 * @interface AndCondition
 * @property {Condition[]} and - An array of conditions all of which must be true.
 */
interface AndCondition {
  and: Condition[]
}

/**
 * Represents a logical OR condition combining multiple conditions.
 * @interface OrCondition
 * @property {Condition[]} or - An array of conditions where at least one must be true.
 */
interface OrCondition {
  or: Condition[]
}

/**
 * Represents a logical NOT condition negating multiple conditions.
 * @interface NotCondition
 * @property {Condition[]} not - An array of conditions all of which must be false.
 */
interface NotCondition {
  not: Condition[]
}

/**
 * A condition which can be a single comparison or a composite logical condition.
 */
type Condition = SingleCondition | AndCondition | OrCondition | NotCondition

/**
 * Common properties for trigger actions.
 * @property {'high' | 'medium' | 'low'} priority - The priority level of the action.
 * @property {number} delay - Delay in milliseconds before the action executes.
 * @property {Record<string, unknown>} data - Additional data to pass along with the action.
 * @property {Condition[]} conditions - Conditions that must be met for the action to trigger.
 */
type TriggerActionCommons = {
  priority: 'high' | 'medium' | 'low'
  delay: number
  data: Record<string, unknown>
  conditions: Condition[]
}

/**
 * Defines the specific types of trigger actions.
 * @property {Partial<TriggerActionCommons> & { template: string }} mail - Email action with template.
 * @property {Partial<TriggerActionCommons> & { headers: Record<string, unknown>, url: string, method: HttpMethod }} request - HTTP request action.
 */
type TriggerActions = {
  mail: Partial<TriggerActionCommons> & { template: string }
  request: Partial<TriggerActionCommons> & {
    headers: Record<string, unknown>
    url: string
    method: HttpMethod
  }
}

/**
 * Defines trigger types mapped to arrays of trigger actions.
 * @property {Array<Partial<TriggerActions>>} created - Actions triggered on creation events.
 * @property {Array<Partial<TriggerActions>>} updated - Actions triggered on update events.
 * @property {Array<Partial<TriggerActions>>} deleted - Actions triggered on deletion events.
 */
type TriggerTypes = Record<
  'created' | 'updated' | 'deleted',
  Array<Partial<TriggerActions>>
>

/**
 * Represents triggers categorized by their timing ('pre' or 'post') and event types.
 * @typedef {Partial<Record<'pre' | 'post', Partial<TriggerTypes>>>} Triggers
 */
export type Triggers = Partial<Record<'pre' | 'post', Partial<TriggerTypes>>>
