/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Connector, registerCoreConnectorSlot, ZanixCacheConnector } from '@zanix/server'
import { ZanixRedisConnector } from './connector/mod.ts'

/**
 * Connector DSL definition — applies the decorator directly to `ZanixRedisConnector` (calling it
 * as a plain function, not `@Connector(...)` syntax) rather than wrapping it in a throwaway
 * anonymous subclass, so `this.connectors.get(ZanixRedisConnector)` — the class every consumer
 * actually imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the full
 * rationale.
 */
const registerConnector = () => {
  if (!Deno.env.has('REDIS_URI')) return

  Connector('cache:redis')(ZanixRedisConnector)
}

// `@zanix/datamaster` owns the `'cache:redis'` core-connector slot — registered unconditionally,
// independent of whether `REDIS_URI` is actually configured (see `registerConnector` above).
registerCoreConnectorSlot('cache:redis', ZanixCacheConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core Redis cache connector loader for Zanix.
 *
 * This module automatically registers the default Redis connector
 * (`ZanixRedisConnector`) if the environment variable `REDIS_URI` is set.
 * It uses the `Connector('cache:redis')` decorator to register the connector
 * with the Zanix framework.
 *
 * This behavior ensures that, when a Redis connection string is provided,
 * a default cache connector is available without requiring manual setup.
 *
 * @requires Deno.env
 * @requires ZanixRedisConnector
 * @decorator Connector
 *
 * @module
 */
const zanixRedisConnectorCore: void = registerConnector()

export default zanixRedisConnectorCore
