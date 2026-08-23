import type {
  DLQDiscardOptions,
  DLQErrorInfo,
  DLQPushInput,
  DLQRequeueOptions,
  DLQStatus,
} from 'dlq/dlq.typings.ts'

import { BaseRTO, Expose, IsBoolean, IsEnum, IsNumber, IsString } from '@zanix/validator'

/** Every valid `DLQEntryAttrs.status` value — kept in sync with `dlq.model.ts`'s own schema
 * `enum`, since `DLQStatus` itself is a type, not a runtime value `IsEnum` could read directly. */
const DLQ_STATUSES: DLQStatus[] = ['pending', 'claimed', 'failed', 'completed', 'discarded']

/**
 * Body validation for `POST /admin/dlq` (this package's own local admin `push`). `payload` and
 * `error` are passed through unvalidated (`@Expose`) — same reasoning `CreateTriggerRTO`'s own
 * `triggers` field documents: this package owns the DLQ schema itself (`dlq.model.ts`), so a
 * caller's own payload/error shape isn't this RTO's concern to re-validate on top of what
 * `DLQProvider.push()`/Mongoose's own schema already enforce.
 */
export class PushDLQEntryRTO extends BaseRTO implements DLQPushInput {
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
  accessor error!: DLQErrorInfo

  @IsNumber({ optional: true })
  accessor maxAttempts: number | undefined

  @Expose({ optional: true })
  accessor metadata: Record<string, unknown> | undefined
}

/**
 * Query validation for `GET /admin/dlq`. Deliberately narrower than `DLQProvider.list()`'s own
 * `DLQListOptions`: `sort`/`filter` (arbitrary dot-path objects, meant for a programmatic caller
 * that already knows the schema it's querying into) are left off this admin REST surface —
 * filtering by `processType`/`status`/`origin` and paging through results covers the real "browse
 * the queue" use case; a caller that needs `sort`/`filter`'s full expressiveness already has
 * direct access to `DLQProvider`/`DLQAdminService` without going through HTTP.
 */
export class ListDLQEntriesRTO extends BaseRTO {
  @IsString({ optional: true, expose: true })
  accessor processType: string | undefined

  @IsEnum(DLQ_STATUSES, { optional: true, expose: true })
  accessor status: DLQStatus | undefined

  @IsString({ optional: true, expose: true })
  accessor origin: string | undefined

  @IsNumber({ optional: true })
  accessor page: number | undefined

  @IsNumber({ optional: true })
  accessor limit: number | undefined
}

/** Body validation for `POST /admin/dlq/:id/requeue` — see `DLQProvider.requeue`. */
export class RequeueDLQEntryRTO extends BaseRTO implements DLQRequeueOptions {
  @IsBoolean({ optional: true, expose: true })
  accessor resetAttempts: boolean | undefined
}

/** Body validation for `POST /admin/dlq/:id/discard` — see `DLQProvider.discard`. */
export class DiscardDLQEntryRTO extends BaseRTO implements DLQDiscardOptions {
  @IsString({ optional: true, expose: true })
  accessor reason: string | undefined
}
