/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixQLRUConnector } from './connector.ts'
import { Connector } from '@zanix/server'

/** Connector loader */
const connectorHOC = () => {
  @Connector({ type: 'cache:local', autoInitialize: false })
  class _ZanixLocalCacheCoreConnector extends ZanixQLRUConnector {}
}

/**
 * Core QuickLRU cache connector loader for Zanix.
 *
 * This module automatically registers the default QuickLRU connector (`_ZanixLocalCacheCoreConnector`).
 * It uses the `@Connector('cache:local')` decorator to register the connector
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
const zanixQLRUConnectorCore: void = connectorHOC()

export default zanixQLRUConnectorCore
