import { BaseRTO, IsString } from '@zanix/validator'

/**
 * Route params for a business service's own local `/admin/triggers/:model`. Deliberately distinct
 * from a proxying aggregator's own equivalent RTO (`@zanix/admin`'s `TriggerServiceModelParamsRTO`)
 * — a proxying consumer's own route also needs a `serviceId` to resolve which service to call, so
 * it needs its own params RTO shape regardless.
 */
export class TriggerModelParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor model!: string
}
