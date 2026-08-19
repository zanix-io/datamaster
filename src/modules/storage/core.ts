/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { SeaweedFSConnectorOptions } from './typings/general.ts'

import { SEAWEEDFS_S3_ENDPOINT_ENV, SeaweedFSObjectStorage } from './connector.ts'
import { Connector, registerCoreConnectorSlot, ZanixConnector } from '@zanix/server'

/** Connector DSL definition */
const registerConnector = () => {
  if (!Deno.env.has(SEAWEEDFS_S3_ENDPOINT_ENV)) return

  @Connector({ slot: 's3', autoInitialize: false })
  class _SeaweedFSCoreObjectStorage extends SeaweedFSObjectStorage {
    constructor(options: SeaweedFSConnectorOptions = {}) {
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
 * Core `SeaweedFSObjectStorage` connector loader for Zanix.
 *
 * Registers the default connector (`_SeaweedFSCoreObjectStorage`) automatically when
 * `SEAWEEDFS_S3_ENDPOINT` is set, under the `'s3'` core connector slot. Unlike `'database'`/
 * `'search'`, `'s3'` isn't one of `CoreBaseClass`'s six hardcoded slots (`kvLocal`, `database`,
 * `search`, `asyncmq`, `cache`, `worker`), so there's no `this.s3` getter — resolve it instead via
 * `this.connectors.get('s3')` (any `ZanixProvider`/`CoreBaseClass` subclass), `this
 * .getProviderConnector('s3')` (a `ZanixProvider`'s own protected helper — throws a well-formed
 * `TargetError` if unconfigured, the friendlier option for provider code), or
 * `ProgramModule.getConnectors(undefined, false).get('s3')` (a plain function call, usable anywhere
 * — the same technique `ZanixElasticsearchConnector`'s own `getConnector()` helper uses for
 * `'search'`). When the endpoint isn't configured, the slot exists (so referencing it never throws
 * a "no such slot" error) but has no registered class to construct — `.get('s3')` itself still
 * throws in that case, so callers must check `Deno.env.has('SEAWEEDFS_S3_ENDPOINT')` (or catch)
 * before relying on it being available.
 *
 * @requires Deno.env
 * @requires SeaweedFSObjectStorage
 * @decorator Connector
 *
 * @module
 */
const seaweedFSConnectorCore: void = registerConnector()

export default seaweedFSConnectorCore
