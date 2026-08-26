/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { S3ConnectorOptions } from './typings/general.ts'

import type { TargetBaseClass } from '@zanix/server'

import { Connector, registerCoreConnectorSlot, ZanixConnector } from '@zanix/server'
import { S3_ENDPOINT_ENV } from './s3-env.ts'

/**
 * `./connector.ts`'s own module specifier, kept in a local variable rather than written as an
 * inline string literal in the `import()` call below. Deno's static dependency-graph analysis (and
 * a real bundler's, transitively) only follows a dynamic `import()` whose argument it can resolve
 * as a literal at parse time — routing it through this constant is what keeps
 * `@aws-sdk/client-s3` out of the reachable graph for a consumer that never actually sets
 * `S3_ENDPOINT` (confirmed via a real `deno info --json` probe: a literal `import('./connector.ts')`
 * here is followed and materializes the package regardless of the surrounding runtime env check;
 * this non-literal form is not).
 */
const CONNECTOR_MODULE_SPECIFIER = './connector.ts'

/**
 * Narrow local mirror of `./connector.ts`'s own `S3ObjectStorage` constructor shape — deliberately
 * NOT `typeof import('./connector.ts')`. Even fully erased at runtime, a `typeof import(...)` type
 * still forces TypeScript to resolve that file's real source to compute the type, which reaches the
 * same `@aws-sdk/client-s3` import a value import would — defeating the whole point of this file.
 * Covers only what `_S3CoreObjectStorage` below actually needs (a constructor accepting one
 * optional `S3ConnectorOptions` argument), not a full mirror of `S3ObjectStorage`'s real public API.
 */
interface LazyS3ObjectStorageConstructor {
  new (options?: S3ConnectorOptions): TargetBaseClass
  /** The class's prototype, i.e., the instance shape produced by `new` — required for `@Connector`
   * to accept this as a valid `ClassConstructor` (`@zanix/server`'s own constraint). */
  prototype: TargetBaseClass
}

/**
 * Connector DSL definition — exported (not just auto-run below) so a caller can re-register after
 * clearing the `'type:connector'` registry (`closeAllConnections()`/
 * `ProgramModule.targets.resetContainer(['type:connector'])`, both in `@zanix/server`), without
 * needing a fresh module evaluation of this file. Re-reads `Deno.env` each call, so a config-reload
 * in a long-running process — or a test simulating a different env state between cases — gets a
 * genuinely current registration, not a stale decision baked in at first import.
 *
 * Async, unlike every sibling `register<X>Connector()` in this package: `S3ObjectStorage` is
 * imported lazily, only once `S3_ENDPOINT` is set, because `./connector.ts`'s own top-level
 * `@aws-sdk/client-s3` import would otherwise resolve unconditionally for every consumer of
 * `@zanix/datamaster/core` — S3-compatible object storage is a much rarer, opt-in capability than
 * the Mongo/Redis wiring this zero-config barrel otherwise exists for, and most `/core` consumers
 * never set `S3_ENDPOINT` at all. Every other field/caller in this module completes synchronously up
 * to the `Deno.env.has` check; only a caller that actually has `S3_ENDPOINT` set pays for an `await`
 * before the `'s3'` slot holds a constructed connector. Callers — including this file's own
 * bottom-of-file auto-run — must `await` this call before relying on that.
 */
export const registerS3Connector = async (): Promise<void> => {
  if (!Deno.env.has(S3_ENDPOINT_ENV)) return

  const { S3ObjectStorage } = (await import(CONNECTOR_MODULE_SPECIFIER)) as {
    S3ObjectStorage: LazyS3ObjectStorageConstructor
  }

  @Connector({ slot: 's3', autoInitialize: false })
  class _S3CoreObjectStorage extends S3ObjectStorage {
    constructor(options: S3ConnectorOptions = {}) {
      super(options)
    }
  }
}

// `@zanix/datamaster` owns the `'s3'` core-connector slot — registered unconditionally, independent
// of whether an endpoint is actually configured (see `registerConnector` above). There's no
// object-storage-shaped base class in `@zanix/server` (confirmed: none of its 8 known core slots are
// shaped for bytes-by-key storage), so this slot is backed by `ZanixConnector` directly rather than
// a dedicated `ZanixStorageConnector` subtype — same mechanism `'search'` uses in
// `../observability/core.ts`, just without an intermediate abstract base.
registerCoreConnectorSlot('s3', ZanixConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core `S3ObjectStorage` connector loader for Zanix.
 *
 * Registers the default connector (`_S3CoreObjectStorage`) automatically when
 * `S3_ENDPOINT` is set, under the `'s3'` core connector slot. Unlike `'database'`/
 * `'search'`, `'s3'` isn't one of `CoreBaseClass`'s six hardcoded slots (`kvLocal`, `database`,
 * `search`, `asyncmq`, `cache`, `worker`), so there's no `this.s3` getter — resolve it instead via
 * `this.connectors.get('s3')` (any `ZanixProvider`/`CoreBaseClass` subclass), `this
 * .getProviderConnector('s3')` (a `ZanixProvider`'s own protected helper — throws a well-formed
 * `TargetError` if unconfigured, the friendlier option for provider code), or
 * `ProgramModule.getConnectors(undefined, false).get('s3')` (a plain function call, usable anywhere
 * — the same technique `ZanixElasticsearchConnector`'s own `getConnector()` helper uses for
 * `'search'`). When the endpoint isn't configured, the slot exists (so referencing it never throws
 * a "no such slot" error) but has no registered class to construct — `.get('s3')` itself still
 * throws in that case, so callers must check `Deno.env.has('S3_ENDPOINT')` (or catch)
 * before relying on it being available.
 *
 * A real top-level `await` — required so that any module reaching this file (statically via
 * `export * from 'storage/core.ts'` in `../core.ts`, or dynamically) only finishes evaluating once
 * the `'s3'` slot registration above has actually completed, per standard ES module semantics.
 *
 * @requires Deno.env
 * @requires S3ObjectStorage
 * @decorator Connector
 *
 * @module
 */
const s3ConnectorCore: void = await registerS3Connector()

export default s3ConnectorCore
