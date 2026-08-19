import type { CreateTriggerInput, Triggers, UpdateTriggerInput } from 'database/mod.ts'

import { BaseRTO, Expose, IsBoolean, IsString } from '@zanix/validator'

/**
 * Body validation for this package's own local `/admin/triggers` CRUD. Also reused, unchanged, by
 * `@zanix/admin`'s proxying aggregator (`POST /triggers/:serviceId`) — a proxying request forwards
 * this body to the target service's own admin API unchanged, so both sides validate the identical
 * wire shape; `@zanix/admin` imports this RTO from `@zanix/datamaster` rather than redefining it.
 */
export class CreateTriggerRTO extends BaseRTO implements CreateTriggerInput {
  @IsString({ expose: true })
  accessor model!: string

  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean = true

  /** Same shape as a model's static `extensions.triggers` — not deeply validated here, only
   * passed through; this package owns the trigger-action schema itself. */
  @Expose()
  accessor triggers!: Triggers
}

/** Body validation for `PUT /admin/triggers/:model` — see {@link CreateTriggerRTO}. Also reused
 * unchanged by `@zanix/admin`'s proxying aggregator's own `PUT /triggers/:serviceId/:model`. */
export class UpdateTriggerRTO extends BaseRTO implements UpdateTriggerInput {
  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean | undefined

  @Expose({ optional: true })
  accessor triggers: Triggers | undefined
}
