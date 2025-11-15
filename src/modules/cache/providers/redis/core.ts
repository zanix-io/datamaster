/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixRedisConnector } from './connector/mod.ts'
import { Connector } from '@zanix/server'

/** Connector HOC */
const connectorHOC = () => {
  if (!Deno.env.get('REDIS_URI')) return

  @Connector('cache:redis')
  class _ZanixRedisCoreConnector extends ZanixRedisConnector {}
}

/**
 * Core Redis cache connector loader for Zanix.
 *
 * This module automatically registers the default Redis connector
 * (`_ZanixRedisCoreConnector`) if the environment variable `REDIS_URI` is set.
 * It uses the `@Connector('cache:redis')` decorator to register the connector
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
const zanixRedisConnectorCore: void = connectorHOC()

export default zanixRedisConnectorCore
