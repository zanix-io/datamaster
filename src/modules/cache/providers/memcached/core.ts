/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Connector, registerCoreConnectorSlot, ZanixCacheConnector } from '@zanix/server'
import { MEMCACHED_URI_ENV, ZanixMemcachedConnector } from './connector/mod.ts'

/**
 * Connector DSL definition — applies the decorator directly to `ZanixMemcachedConnector` (calling
 * it as a plain function, not `@Connector(...)` syntax) rather than wrapping it in a throwaway
 * anonymous subclass, so `this.connectors.get(ZanixMemcachedConnector)` — the class every
 * consumer actually imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the
 * full rationale.
 */
// Exported (not just auto-run below) so a caller can re-register after clearing the
// `'type:connector'` registry (`closeAllConnections()`/
// `ProgramModule.targets.resetContainer(['type:connector'])`, both in `@zanix/server`), without
// needing a fresh module evaluation of this file — see `storage/core.ts`'s own
// `registerS3Connector` doc for the full reasoning, same pattern here.
export const registerMemcachedConnector = (): void => {
  if (!Deno.env.has(MEMCACHED_URI_ENV)) return

  Connector('cache:memcached')(ZanixMemcachedConnector)
}

// `@zanix/datamaster` owns the `'cache:memcached'` core-connector slot — registered
// unconditionally, independent of whether `MEMCACHED_URI` is actually configured (see
// `registerMemcachedConnector` above).
registerCoreConnectorSlot('cache:memcached', ZanixCacheConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core Memcached cache connector loader for Zanix.
 *
 * This module automatically registers the default Memcached connector
 * (`ZanixMemcachedConnector`) if the environment variable `MEMCACHED_URI` is set.
 * It uses the `Connector('cache:memcached')` decorator to register the connector
 * with the Zanix framework.
 *
 * This behavior ensures that, when a Memcached connection string is provided,
 * a default cache connector is available without requiring manual setup.
 *
 * @requires Deno.env
 * @requires ZanixMemcachedConnector
 * @decorator Connector
 *
 * @module
 */
const zanixMemcachedConnectorCore: void = registerMemcachedConnector()

export default zanixMemcachedConnectorCore
