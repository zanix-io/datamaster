import { InternalError } from '@zanix/errors'

/**
 * Env var selecting which search-engine backend registers under the shared `'search'` core
 * connector slot. Replaces the previous per-backend gating (`ELASTICSEARCH_URL`/`OPENSEARCH_URL`/
 * `MEILISEARCH_URL`, one implying its own backend) — since `'search'` backs a single instance, not
 * independently-coexisting ones the way `@zanix/auth`'s OAuth2 providers are, a single explicit
 * selector makes "which backend" and "is a backend configured at all" the same decision, so two
 * backends can never both be configured for the same deployment.
 *
 * Set to one of {@link SEARCH_ENGINES}. Unset means no backend is configured for `'search'` — the
 * equivalent of the old "no cluster/instance URL set" no-op.
 */
export const SEARCH_ENGINE_ENV = 'SEARCH_ENGINE'

/**
 * Env var for the selected search engine's connection URL — read by whichever connector class
 * {@link SEARCH_ENGINE_ENV} selects (`ZanixElasticsearchConnector`'s `resolveNode()`,
 * `MeilisearchConnector`'s `resolveHost()`). Replaces the previous per-backend `ELASTICSEARCH_URL`/
 * `OPENSEARCH_URL`/`MEILISEARCH_URL` vars with one generic name, now that the engine itself is
 * already disambiguated by `SEARCH_ENGINE`.
 */
export const SEARCH_URL_ENV = 'SEARCH_URL'

/**
 * Env var for an Elasticsearch API key, used to build the `ApiKey` auth header when the connector's
 * explicit `auth` option is left unset — see `ZanixElasticsearchConnector`'s `resolveAuth()`. Falls
 * back to {@link OPENSEARCH_API_KEY_ENV} if unset.
 */
export const ELASTICSEARCH_API_KEY_ENV = 'ELASTICSEARCH_API_KEY'

/**
 * Env var for an OpenSearch API key — same role as {@link ELASTICSEARCH_API_KEY_ENV}, checked
 * second by `resolveAuth()` since both backends share the same connector class/wire protocol.
 */
export const OPENSEARCH_API_KEY_ENV = 'OPENSEARCH_API_KEY'

/** Supported {@link SEARCH_ENGINE_ENV} values, one per real `'search'`-slot connector class shipped
 * today — `'elasticsearch'`/`'opensearch'` both select `ZanixElasticsearchConnector` (the same wire
 * protocol backs both), `'meilisearch'` selects `MeilisearchConnector`. */
export const SEARCH_ENGINES = ['elasticsearch', 'opensearch', 'meilisearch'] as const

/** A supported {@link SEARCH_ENGINE_ENV} value. */
export type SearchEngine = typeof SEARCH_ENGINES[number]

/**
 * Resolves the configured search engine from `SEARCH_ENGINE`.
 *
 * Called from inside both `registerElasticsearchConnector()`/`registerMeilisearchConnector()`
 * (`observability/core.ts`) — each register function only proceeds when this resolves to the
 * engine it owns, so a standalone re-registration after a registry reset (see
 * `datamaster-connector-registration`'s re-registration pattern) re-validates `SEARCH_ENGINE`
 * every time, not just on the first module load.
 *
 * @returns The selected engine, or `undefined` if `SEARCH_ENGINE` is unset (no `'search'` backend
 * configured for this deployment).
 * @throws {InternalError} If `SEARCH_ENGINE` is set to a value outside {@link SEARCH_ENGINES}.
 */
export function resolveSearchEngine(): SearchEngine | undefined {
  const value = Deno.env.get(SEARCH_ENGINE_ENV)
  if (!value) return undefined

  if (!(SEARCH_ENGINES as readonly string[]).includes(value)) {
    throw new InternalError(
      `[search] "${SEARCH_ENGINE_ENV}" is set to "${value}", which isn't a supported search ` +
        `engine — use one of: ${SEARCH_ENGINES.join(', ')}.`,
      { code: 'SEARCH_ENGINE_UNSUPPORTED', meta: { value, supported: SEARCH_ENGINES } },
    )
  }

  return value as SearchEngine
}
