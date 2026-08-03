/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Connector } from '@zanix/server'
import { ZanixMongoConnector } from './mod.ts'
import { DEFAULT_CONNECTOR_KEY } from 'database/utils/constants.ts'

/**
 * Connector DSL definition — applies the decorator directly to `ZanixMongoConnector` (calling it
 * as a plain function, not `@Connector(...)` syntax) rather than wrapping it in a throwaway
 * anonymous subclass, so `this.connectors.get(ZanixMongoConnector)` — the class every consumer
 * actually imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the full
 * rationale (provider-side, same reasoning applies to connectors).
 *
 * The `'database'` slot itself is registered unconditionally in `./mod.ts` (not here) — see that
 * module's own comment for why: it needs to be guaranteed by merely importing
 * `ZanixMongoConnector`, not gated behind this file (or `MONGO_URI`) ever running.
 */
const registerConnector = () => {
  if (!Deno.env.has('MONGO_URI')) return

  Connector(DEFAULT_CONNECTOR_KEY)(ZanixMongoConnector)
}

/**
 * Core database connector loader for Zanix.
 *
 * This module automatically registers the default MongoDB connector
 * (`ZanixMongoConnector`) if the environment variable `MONGO_URI` is set.
 * It uses the `Connector('database')` decorator to register the connector
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
const zanixMongoConnectorCore: void = registerConnector()

export default zanixMongoConnectorCore
