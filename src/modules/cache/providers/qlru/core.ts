/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Connector, registerCoreConnectorSlot, ZanixCacheConnector } from '@zanix/server'
import { ZanixQLRUConnector } from './connector.ts'

/**
 * Connector DSL definition — applies the decorator directly to `ZanixQLRUConnector` (calling it as
 * a plain function, not `@Connector(...)` syntax) rather than wrapping it in a throwaway anonymous
 * subclass, so `this.connectors.get(ZanixQLRUConnector)` — the class every consumer actually
 * imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the full rationale.
 */
const registerConnector = () => {
  Connector({ slot: 'cache:local', autoInitialize: false, startMode: 'lazy' })(
    ZanixQLRUConnector,
  )
}

// `@zanix/datamaster` owns the `'cache:local'` core-connector slot.
registerCoreConnectorSlot('cache:local', ZanixCacheConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core QuickLRU cache connector loader for Zanix.
 *
 * This module automatically registers the default QuickLRU connector (`ZanixQLRUConnector`).
 * It uses the `Connector('cache:local')` decorator to register the connector
 * with the Zanix framework.
 *
 * This behavior ensures a default cache connector is available without requiring manual setup.
 *
 * @requires Deno.env
 * @requires ZanixQLRUConnector
 * @decorator Connector
 *
 * @module
 */
const zanixQLRUConnectorCore: void = registerConnector()

export default zanixQLRUConnectorCore
