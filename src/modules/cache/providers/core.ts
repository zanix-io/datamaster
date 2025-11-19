/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { ZanixCacheCoreProvider } from './mod.ts'
import { Provider } from '@zanix/server'

/** Provider DSL definition */
const registerProvider = async () => {
  await import('./qlru/core.ts')
  await import('./redis/core.ts')

  @Provider('cache')
  class _ZanixCacheCoreProvider extends ZanixCacheCoreProvider {}
}

/**
 * Core cache provider loader for Zanix.
 *
 * This module automatically registers the default cache provider (`_ZanixCacheCoreProvider`).
 * It uses the `@Provider('cache')` decorator to register the provider
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
const zanixCacheProviderCore: void = await registerProvider()

export default zanixCacheProviderCore
