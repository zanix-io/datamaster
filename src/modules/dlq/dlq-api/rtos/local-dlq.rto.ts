import { BaseRTO, IsString } from '@zanix/validator'

/**
 * Route params for this package's own local `/admin/dlq/:id`. Mirrors `TriggerModelParamsRTO`'s
 * own role for `/admin/triggers/:model` — a single-field params RTO kept in its own file for the
 * same reason: it's specific to this package's own local API, distinct from any proxying
 * aggregator's own equivalent (which would also need a `serviceId` to resolve which service to
 * call).
 */
export class DLQEntryIdParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor id!: string
}
