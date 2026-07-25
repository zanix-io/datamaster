// deno-lint-ignore-file no-explicit-any
import type {
  AndCondition,
  Condition,
  NotCondition,
  OrCondition,
  SingleCondition,
} from 'database/typings/triggers.ts'
import { InternalError } from '@zanix/errors'

/**
 * Validates that every condition in the given set passes against `data`.
 *
 * Conditions are combined with an implicit AND: all must pass for the set to validate.
 *
 * @param data - The document (or plain payload) the conditions are evaluated against.
 * @param conditions - The set of conditions to validate.
 * @returns Whether every condition in the set passed.
 */
export const validateConditions = (data: any, conditions: Condition[]): boolean => {
  return conditions.every((condition) => evaluateCondition(condition, data))
}

const evaluateCondition = (condition: Condition, data: any): boolean => {
  if ('field' in condition && 'op' in condition && 'value' in condition) {
    return evaluateSingleCondition(condition, data)
  }

  if ('and' in condition) {
    return (condition as AndCondition).and.every((sub) => evaluateCondition(sub, data))
  }

  if ('or' in condition) {
    return (condition as OrCondition).or.some((sub) => evaluateCondition(sub, data))
  }

  if ('not' in condition) {
    return !(condition as NotCondition).not.every((sub) => evaluateCondition(sub, data))
  }

  throw new InternalError('An error occurred while evaluating a trigger condition', {
    cause: `Invalid condition format: ${JSON.stringify(condition)}`,
    meta: {
      source: 'zanix',
      suggestion:
        'A condition must have { field, op, value }, or one of { and }, { or }, { not } (each an array of conditions).',
    },
  })
}

/**
 * Resolves a condition's `value` against `data`:
 * - The literal sentinel `'!$undefined'` resolves to `undefined` itself (compare a field against
 *   "not set").
 * - A string starting with `$` resolves to another field on `data` (e.g. `'$endDate'` compares
 *   against `data.endDate`), letting a condition compare two fields on the same document.
 * - Any other value is used as-is.
 */
const resolveValue = (value: SingleCondition['value'], data: any): any => {
  if (value === '!$undefined') return undefined
  if (typeof value === 'string' && value.startsWith('$')) return data?.[value.slice(1)]
  return value
}

const evaluateSingleCondition = (condition: SingleCondition, data: any): boolean => {
  const { field, op, value } = condition

  const fieldValue = data?.[field]
  const opValue = resolveValue(value, data)

  switch (op) {
    case '=':
      return fieldValue === opValue
    case '!=':
      return fieldValue !== opValue
    case '<':
      return fieldValue < opValue
    case '>':
      return fieldValue > opValue
    case '<=':
      return fieldValue <= opValue
    case '>=':
      return fieldValue >= opValue
    case 'includes':
      return Boolean(fieldValue?.includes?.(opValue))
    default:
      throw new InternalError('An error occurred while evaluating a trigger condition', {
        cause: `Unsupported conditional operator: ${op}`,
        meta: {
          source: 'zanix',
          suggestion: "Use one of '<' | '>' | '=' | '<=' | '>=' | 'includes' | '!='.",
        },
      })
  }
}
