import type {
  DlqDiscardOptions,
  DlqErrorInfo,
  DlqPushInput,
  DlqRequeueOptions,
  DlqStatus,
} from 'dlq/dlq.typings.ts'

import { BaseRTO, Expose, IsBoolean, IsEnum, IsNumber, IsString } from '@zanix/validator'

/** Every valid `DlqEntryAttrs.status` value — kept in sync with `dlq.model.ts`'s own schema
 * `enum`, since `DlqStatus` itself is a type, not a runtime value `IsEnum` could read directly. */
const DLQ_STATUSES: DlqStatus[] = ['pending', 'claimed', 'failed', 'completed', 'discarded']

/**
 * Body validation for `POST /admin/dlq` (this package's own local admin `push`). `payload` and
 * `error` are passed through unvalidated (`@Expose`) — same reasoning `CreateTriggerRTO`'s own
 * `triggers` field documents: this package owns the DLQ schema itself (`dlq.model.ts`), so a
 * caller's own payload/error shape isn't this RTO's concern to re-validate on top of what
 * `DlqProvider.push()`/Mongoose's own schema already enforce.
 */
export class PushDlqEntryRTO extends BaseRTO implements DlqPushInput {
  @IsString({ expose: true })
  accessor processType!: string

  @IsString({ expose: true })
  accessor origin!: string

  @IsString({ optional: true, expose: true })
  accessor processId: string | undefined

  /** The original failed payload, in whatever shape the caller pushed — see `docs/dlq.md`'s
   * "Data model" section. */
  @Expose()
  accessor payload: unknown

  /** `{ name, message, stack? }` — not deeply validated here, only passed through. */
  @Expose()
  accessor error!: DlqErrorInfo

  @IsNumber({ optional: true })
  accessor maxAttempts: number | undefined

  @Expose({ optional: true })
  accessor metadata: Record<string, unknown> | undefined
}

/**
 * Query validation for `GET /admin/dlq`. Deliberately narrower than `DlqProvider.list()`'s own
 * `DlqListOptions`: `sort`/`filter` (arbitrary dot-path objects, meant for a programmatic caller
 * that already knows the schema it's querying into) are left off this admin REST surface —
 * filtering by `processType`/`status`/`origin` and paging through results covers the real "browse
 * the queue" use case; a caller that needs `sort`/`filter`'s full expressiveness already has
 * direct access to `DlqProvider`/`DlqAdminService` without going through HTTP.
 */
export class ListDlqEntriesRTO extends BaseRTO {
  @IsString({ optional: true, expose: true })
  accessor processType: string | undefined

  @IsEnum(DLQ_STATUSES, { optional: true, expose: true })
  accessor status: DlqStatus | undefined

  @IsString({ optional: true, expose: true })
  accessor origin: string | undefined

  @IsNumber({ optional: true })
  accessor page: number | undefined

  @IsNumber({ optional: true })
  accessor limit: number | undefined
}

/** Body validation for `POST /admin/dlq/:id/requeue` — see `DlqProvider.requeue`. */
export class RequeueDlqEntryRTO extends BaseRTO implements DlqRequeueOptions {
  @IsBoolean({ optional: true, expose: true })
  accessor resetAttempts: boolean | undefined
}

/** Body validation for `POST /admin/dlq/:id/discard` — see `DlqProvider.discard`. */
export class DiscardDlqEntryRTO extends BaseRTO implements DlqDiscardOptions {
  @IsString({ optional: true, expose: true })
  accessor reason: string | undefined
}
