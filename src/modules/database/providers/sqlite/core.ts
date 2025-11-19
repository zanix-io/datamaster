/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixKVStoreConnector } from './connector.ts'
import { Connector } from '@zanix/server'

/**
 * DSL function that decorates the `ZanixKVStoreConnector` using the Zanix `@Connector`
 * decorator, registering it as a KV connector within the framework.
 */
const registerConnector = () => {
  @Connector({ type: 'kvLocal', autoInitialize: false, startMode: 'lazy' })
  class _ZanixKVConnector extends ZanixKVStoreConnector {}
}

/**
 * Core Zanix KV connector loader for the Zanix framework.
 *
 * This module automatically registers the default KV connector (`_ZanixKVConnector`)
 * using the `@Connector()` decorator, making it available to the Zanix framework
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
