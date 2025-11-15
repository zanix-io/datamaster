/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixMongoConnector } from './mod.ts'
import { Connector } from '@zanix/server'

/** Connector HOC */
const connectorHOC = () => {
  if (!Deno.env.get('MONGO_URI')) return

  @Connector('database')
  class _ZanixMongoCoreConnector extends ZanixMongoConnector {}
}

/**
 * Core database connector loader for Zanix.
 *
 * This module automatically registers the default MongoDB connector
 * (`_ZanixMongoCoreConnector`) if the environment variable `MONGO_URI` is set.
 * It uses the `@Connector('database')` decorator to register the connector
 * with the Zanix framework.
 *
 * This behavior ensures that, when a MongoDB connection string is provided,
 * a default database connector is available without requiring manual setup.
 *
 * @requires Deno.env
 * @requires ZanixMongoConnector
 * @decorator Connector
 *
 * @module
 */
const zanixMongoConnectorCore: void = connectorHOC()

export default zanixMongoConnectorCore
