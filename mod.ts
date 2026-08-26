/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * This module aggregates and exposes the core public modules of the Zanix datamaster.
 *
 * It provides access to the main `ProgramModule`, database utilities, and (optionally)
 * other subsystems like caching or additional service layers.
 *
 * The purpose of this module is to serve as a centralized entry point for importing
 * the project's key functionalities.
 *
 * @module zanixDatamaster
 */

// Main
import ProgramModule from 'modules/program/public.ts'
export { ProgramModule }
export type { Program } from 'modules/program/public.ts'
export type { DatabaseTypes } from 'database/typings/general.ts'
export type { ModelMetadata } from 'database/typings/models.ts'
/** Re-exported so `createTriggersDiscoveryProvider`'s own return type is nameable. */
export type { DiscoveryProvider } from '@zanix/server'

// Global modules
export * from 'modules/database/mod.ts'
export * from 'modules/cache/mod.ts'

/**
 * CRUD data access and business logic for this package's own persisted triggers collection
 * (`zanix-triggers`) — the actual owner of that data. This package also owns the local HTTP
 * surface fronting it — see `@zanix/datamaster/triggers-api`'s own `createTriggersAdminController`.
 * `@zanix/admin` owns a genuinely different, cross-service concern: its own
 * `TriggersAggregator`/`/triggers` proxy over N services' local APIs.
 */
export { TriggersAdminRepository } from 'modules/triggers/triggers.repository.ts'
/** See {@link TriggersAdminRepository}. */
export { TriggersAdminService } from 'modules/triggers/triggers.service.ts'
/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/triggers`, backed by
 * {@link TriggersAdminRepository}. `@zanix/admin`'s `defineAdminMetadata` composes this into an
 * HTTP surface via `ProgramModule.defineDiscovery`; it does not author the provider itself.
 */
export { createTriggersDiscoveryProvider } from 'modules/triggers/triggers-discovery.provider.ts'

/**
 * Dead Letter Queue — a Mongo-backed registry of items that failed in some business process
 * (payments, webhooks, jobs, ...), for auditing/debugging/manual or programmatic retry.
 * Independent of `@zanix/asyncmq`'s own RabbitMQ-native dead-letter mechanism
 * (`ZanixAsyncMQProvider.requeueDeadLetters`) — see `docs/dlq.md`. A consumer that only needs this
 * surface (not the rest of this package's root) imports `@zanix/datamaster/dlq` directly instead —
 * see that subpath's own module doc for why.
 */
export * from 'modules/dlq/mod.ts'

// Deprecated DLQ aliases — this package used to case the `DLQ` acronym all-caps; it now
// consistently cases it `Dlq` (see CHANGELOG's `[Unreleased]` entry). These re-export the exact
// same bindings under their old names for one deprecation window — `Dlq...` above is the
// recommended form; don't reach for these in new code.
/** @deprecated Use {@link DlqProvider} instead — this alias will be removed in a future major
 * release. */
export { DlqProvider as DLQProvider } from 'modules/dlq/dlq.provider.ts'
/** @deprecated Use {@link ZanixCoreDlqProvider} instead — this alias will be removed in a future
 * major release. */
export { ZanixCoreDlqProvider as ZanixCoreDLQProvider } from 'modules/dlq/dlq.provider.ts'
/** @deprecated Use {@link DlqAdminService} instead — this alias will be removed in a future major
 * release. */
export { DlqAdminService as DLQAdminService } from 'modules/dlq/dlq.service.ts'
/** @deprecated Use {@link registerDlqModel} instead — this alias will be removed in a future major
 * release. */
export { registerDlqModel as registerDLQModel } from 'modules/dlq/dlq.model.ts'
/** @deprecated Use {@link RegisterDlqModelOptions} instead — this alias will be removed in a
 * future major release. */
export type { RegisterDlqModelOptions as RegisterDLQModelOptions } from 'modules/dlq/dlq.model.ts'
/** @deprecated Use {@link DlqClaimOptions} instead — this alias will be removed in a future major
 * release. */
export type { DlqClaimOptions as DLQClaimOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqDiscardOptions} instead — this alias will be removed in a future
 * major release. */
export type { DlqDiscardOptions as DLQDiscardOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqEntryAttrs} instead — this alias will be removed in a future major
 * release. */
export type { DlqEntryAttrs as DLQEntryAttrs } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqErrorHistoryEntry} instead — this alias will be removed in a future
 * major release. */
export type { DlqErrorHistoryEntry as DLQErrorHistoryEntry } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqErrorInfo} instead — this alias will be removed in a future major
 * release. */
export type { DlqErrorInfo as DLQErrorInfo } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqFailOptions} instead — this alias will be removed in a future major
 * release. */
export type { DlqFailOptions as DLQFailOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqLeaseOptions} instead — this alias will be removed in a future major
 * release. */
export type { DlqLeaseOptions as DLQLeaseOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqListOptions} instead — this alias will be removed in a future major
 * release. */
export type { DlqListOptions as DLQListOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqPushInput} instead — this alias will be removed in a future major
 * release. */
export type { DlqPushInput as DLQPushInput } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqRequeueOptions} instead — this alias will be removed in a future
 * major release. */
export type { DlqRequeueOptions as DLQRequeueOptions } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqStatus} instead — this alias will be removed in a future major
 * release. */
export type { DlqStatus as DLQStatus } from 'modules/dlq/dlq.typings.ts'
/** @deprecated Use {@link DlqPaginatedResult} instead — this alias will be removed in a future
 * major release. */
export type { DlqPaginatedResult as DLQPaginatedResult } from 'modules/dlq/dlq.provider.ts'

// Data protection
export {
  createDecryptableObject,
  createHashFrom as datamasterHash,
  createUnmaskableObject,
  createVerifiableObject,
  decrypt as datamasterDecrypt,
  encrypt as datamasterEncrypt,
  mask as datamasterMask,
  unmask as datamasterUnmask,
} from 'utils/protection.ts'

// General types
export type {
  DecryptableArray,
  DecryptableObject,
  DecryptableScalar,
  RequiredDecryptableArray,
  RequiredDecryptableScalar,
  RequiredUnmaskableArray,
  RequiredUnmaskableScalar,
  RequiredVerifiableArray,
  RequiredVerifiableScalar,
  UnmaskableArray,
  UnmaskableObject,
  UnmaskableScalar,
  VerifiableArray,
  VerifiableObject,
  VerifiableScalar,
} from 'typings/data.ts'
