/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { ElasticsearchConnectorOptions } from './typings/general.ts'

import {
  ELASTICSEARCH_URL_ENV,
  OPENSEARCH_URL_ENV,
  ZanixElasticsearchConnector,
} from './connector.ts'
import { Connector, registerCoreConnectorSlot, ZanixSearchConnector } from '@zanix/server'

/** Connector DSL definition */
const registerConnector = () => {
  if (
    !Deno.env.has(ELASTICSEARCH_URL_ENV) && !Deno.env.has(OPENSEARCH_URL_ENV)
  ) return

  @Connector({ slot: 'search', autoInitialize: false })
  class _ZanixElasticsearchCoreConnector extends ZanixElasticsearchConnector {
    constructor(options: ElasticsearchConnectorOptions = {}) {
      super({ ...options, index: { ...options.index } })
    }
  }
}

// `@zanix/datamaster` owns the `'search'` core-connector slot — registered unconditionally,
// independent of whether a cluster URL is actually configured (see `registerConnector` above).
registerCoreConnectorSlot('search', ZanixSearchConnector, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core Elasticsearch/OpenSearch connector loader for Zanix.
 *
 * This module automatically registers the default connector (`_ZanixElasticsearchCoreConnector`)
 * if either the `ELASTICSEARCH_URL` or `OPENSEARCH_URL` environment variable is set. It uses the
 * `@Connector('search')` decorator to register the connector with the Zanix framework, under the
 * `search` core connector type `@zanix/server`'s `ZanixSearchConnector` defines.
 *
 * This behavior ensures that, when a cluster URL is provided, a default observability connector
 * is available without requiring manual setup — the same pattern `ZanixMongoConnector`'s and
 * `ZanixRedisConnector`'s own `core.ts` loaders already follow.
 *
 * @requires Deno.env
 * @requires ZanixElasticsearchConnector
 * @decorator Connector
 *
 * @module
 */
const zanixElasticsearchConnectorCore: void = registerConnector()

export default zanixElasticsearchConnectorCore
