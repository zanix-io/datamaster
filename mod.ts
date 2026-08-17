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
 * (`zanix-triggers`) — the actual owner of that data. `@zanix/admin`'s
 * `createTriggersAdminController` composes {@link TriggersAdminService} into a business
 * service's own `/admin/triggers` HTTP surface; it does not author this logic itself.
 */
export { TriggersAdminRepository } from 'modules/triggers/triggers.repository.ts'
/** See {@link TriggersAdminRepository}. */
export { TriggersAdminService } from 'modules/triggers/triggers.service.ts'
/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/triggers`, backed by
 * {@link TriggersAdminRepository}. `@zanix/admin` composes this into an HTTP surface via
 * `ProgramModule.defineDiscovery`; it does not author the provider itself.
 */
export { createTriggersDiscoveryProvider } from 'modules/triggers/triggers-discovery.provider.ts'

/**
 * Dead Letter Queue — a Mongo-backed registry of items that failed in some business process
 * (payments, webhooks, jobs, ...), for auditing/debugging/manual or programmatic retry.
 * Independent of `@zanix/asyncmq`'s own RabbitMQ-native dead-letter mechanism
 * (`ZanixAsyncMQProvider.requeueDeadLetters`) — see `docs/DLQ.md`.
 */
export { DLQProvider, ZanixCoreDLQProvider } from 'modules/dlq/dlq.provider.ts'
/** Registers `@zanix/datamaster`'s own DLQ model — required once before `DLQProvider` resolves. */
export {
  DEFAULT_DLQ_MODEL,
  defaultLeaseTtlMs,
  DLQ_DEFAULT_LEASE_MS_ENV,
  DLQ_ENCRYPT_PAYLOAD_ENV,
  DLQ_MODEL_ENV,
  dlqModelName,
  registerDLQModel,
} from 'modules/dlq/dlq.model.ts'
export type { RegisterDLQModelOptions } from 'modules/dlq/dlq.model.ts'
export type {
  DLQClaimOptions,
  DLQDiscardOptions,
  DLQEntryAttrs,
  DLQErrorHistoryEntry,
  DLQErrorInfo,
  DLQFailOptions,
  DLQLeaseOptions,
  DLQListOptions,
  DLQPushInput,
  DLQRequeueOptions,
  DLQStatus,
} from 'modules/dlq/dlq.typings.ts'
export type { DLQPaginatedResult } from 'modules/dlq/dlq.provider.ts'

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
