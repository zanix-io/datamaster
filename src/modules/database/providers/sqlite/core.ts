/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Connector, registerCoreConnectorSlot, ZanixKVConnector } from '@zanix/server'
import { ZanixKVStoreConnector } from './connector.ts'

/**
 * DSL function that decorates `ZanixKVStoreConnector` directly (calling the decorator as a plain
 * function, not `@Connector(...)` syntax) rather than wrapping it in a throwaway anonymous
 * subclass, so `this.connectors.get(ZanixKVStoreConnector)` — the class every consumer actually
 * imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the full rationale.
 */
const registerConnector = () => {
  Connector({ slot: 'kvLocal', autoInitialize: false, startMode: 'lazy' })(
    ZanixKVStoreConnector,
  )
}

// `@zanix/datamaster` owns the `'kvLocal'` core-connector slot.
registerCoreConnectorSlot('kvLocal', ZanixKVConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core Zanix KV connector loader for the Zanix framework.
 *
 * This module automatically registers the default KV connector (`ZanixKVStoreConnector`)
 * using the `Connector()` decorator, making it available to the Zanix framework
 * without requiring manual setup.
 *
 * Key features:
 * - Registers a default KV storage connector lazily.
 * - Ensures integration with Zanix dependency injection and lifecycle management.
 *
 * @module zanixKVConnectorCore
 * @requires Deno.env
 * @requires ZanixKVConnector
 * @decorator Connector
 * @example
 * import zanixKVConnectorCore from './zanix_kv_connector_core.ts';
 * // Connector is automatically registered and ready to use
 */
const zanixKVConnectorCore: void = registerConnector()

export default zanixKVConnectorCore
