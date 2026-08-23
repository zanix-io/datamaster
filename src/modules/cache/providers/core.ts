/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixCacheCoreProvider } from './mod.ts'
import { Provider, registerCoreProviderSlot, ZanixCacheProvider } from '@zanix/server'

// Connectors DSL load — `export *` (not a plain side-effect `import`) so each one's own
// `registerQLRUConnector`/`registerRedisConnector`/`registerMemcachedConnector` propagates up
// through this module's own `export *` re-export in the top-level `core.ts` barrel, reachable via
// `@zanix/datamaster/core`.
export * from './qlru/core.ts'
export * from './redis/core.ts'
export * from './memcached/core.ts'

/**
 * Provider DSL definition — applies the decorator directly to `ZanixCacheCoreProvider` (calling it
 * as a plain function, not `@Provider(...)` syntax) rather than wrapping it in a throwaway
 * anonymous subclass, so `this.providers.get(ZanixCacheCoreProvider)` — the class every consumer
 * actually imports — resolves correctly. See `@zanix/auth`'s `providers/core.ts` for the full
 * rationale. Exported (not just auto-run below) for the same reason every connector DSL definition
 * in this package now is — see `storage/core.ts`'s own `registerS3Connector` doc.
 */
export const registerCacheProvider = (): void => {
  Provider('cache')(ZanixCacheCoreProvider)
}

// `@zanix/datamaster` owns the `'cache'` core-provider slot — registered unconditionally here,
// mirroring `@zanix/auth`'s own `'auth'` slot registration (`auth/src/modules/providers/core.ts`).
registerCoreProviderSlot('cache', ZanixCacheProvider, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core cache provider loader for Zanix.
 *
 * This module automatically registers the default cache provider (`ZanixCacheCoreProvider`).
 * It uses the `Provider('cache')` decorator to register the provider
 * with the Zanix framework.
 *
 * This behavior ensures a default cache provider is available without requiring manual setup.
 *
 * @requires Deno.env
 * @requires ZanixCacheProvider
 * @decorator Provider
 *
 * @module
 */
const zanixCacheProviderCore: void = registerCacheProvider()

export default zanixCacheProviderCore
