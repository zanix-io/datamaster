/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type {
  ElasticsearchConnectorOptions,
  MeilisearchConnectorOptions,
} from './typings/general.ts'

import { ZanixElasticsearchConnector } from './connector.ts'
import { MeilisearchConnector } from './meilisearch-connector.ts'
import { resolveSearchEngine } from './search-config.ts'
import { Connector, registerCoreConnectorSlot, ZanixSearchConnector } from '@zanix/server'

/**
 * Connector DSL definition — exported (not just auto-run below) so a caller can re-register after
 * clearing the `'type:connector'` registry (`closeAllConnections()`/
 * `ProgramModule.targets.resetContainer(['type:connector'])`, both in `@zanix/server`), without
 * needing a fresh module evaluation of this file — see `storage/core.ts`'s own
 * `registerS3Connector` doc for the full reasoning, same pattern here.
 */
export const registerElasticsearchConnector = (): void => {
  const engine = resolveSearchEngine()
  if (engine !== 'elasticsearch' && engine !== 'opensearch') return

  @Connector({ slot: 'search', autoInitialize: false })
  class _ZanixElasticsearchCoreConnector extends ZanixElasticsearchConnector {
    constructor(options: ElasticsearchConnectorOptions = {}) {
      super({ ...options, index: { ...options.index } })
    }
  }
}

/**
 * Connector DSL definition for Meilisearch — same exported-for-re-registration shape as
 * `registerElasticsearchConnector()` above; see that function's own doc for the full reasoning.
 */
export const registerMeilisearchConnector = (): void => {
  const engine = resolveSearchEngine()
  if (engine !== 'meilisearch') return

  @Connector({ slot: 'search', autoInitialize: false })
  class _MeilisearchCoreConnector extends MeilisearchConnector {
    constructor(options: MeilisearchConnectorOptions = {}) {
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
 * Core search connector loader for Zanix.
 *
 * This module registers the connector matching `SEARCH_ENGINE` (`elasticsearch`/`opensearch` →
 * `_ZanixElasticsearchCoreConnector`, `meilisearch` → `_MeilisearchCoreConnector`) for the shared
 * `'search'` core connector slot, reading its connection URL from `SEARCH_URL` — see
 * `search-config.ts`'s `resolveSearchEngine()`. Leaving `SEARCH_ENGINE` unset registers no
 * connector for `'search'` at all.
 *
 * This behavior ensures that, when a search engine is selected, a default observability connector
 * is available without requiring manual setup — the same pattern `ZanixMongoConnector`'s and
 * `ZanixRedisConnector`'s own `core.ts` loaders already follow.
 *
 * `'search'` backs a single instance, never independently-coexisting ones the way `@zanix/auth`'s
 * OAuth2 providers are — `SEARCH_ENGINE` being a single selector (rather than one gating env var
 * per backend) makes configuring two backends for the same deployment structurally impossible,
 * rather than something caught by a dedicated conflict guard at boot.
 *
 * @requires Deno.env
 * @requires ZanixElasticsearchConnector
 * @requires MeilisearchConnector
 * @decorator Connector
 *
 * @module
 */
const zanixElasticsearchConnectorCore: void = registerElasticsearchConnector()

/** Registers the `'search'` core connector slot with a Meilisearch backend; see the module doc above. */
const zanixMeilisearchConnectorCore: void = registerMeilisearchConnector()

export default zanixElasticsearchConnectorCore
export { zanixMeilisearchConnectorCore }
