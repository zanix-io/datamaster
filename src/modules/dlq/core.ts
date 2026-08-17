/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { DLQProvider, ZanixCoreDLQProvider } from './dlq.provider.ts'
import { Provider, registerCoreProviderSlot } from '@zanix/server'

/**
 * Provider DSL definition — applies the decorator directly to `DLQProvider` (calling it as a plain
 * function, not `@Provider(...)` syntax) rather than wrapping it in a throwaway anonymous subclass,
 * so `this.providers.get(DLQProvider)` — the class every consumer actually imports — resolves
 * correctly. See `@zanix/auth`'s `providers/core.ts` for the full rationale.
 */
const registerProvider = () => {
  Provider({ slot: 'dlq' })(DLQProvider)
}

// `@zanix/datamaster` owns the `'dlq'` core-provider slot — registered unconditionally here,
// mirroring `@zanix/auth`'s own `'auth'` slot registration (`auth/src/modules/providers/core.ts`).
// No dedicated `this.dlq` getter on `CoreBaseClass`: unlike the 6 foundational slots (`cache`,
// `database`, ...), typing one here would require `@zanix/server` to gain new domain knowledge it
// has no other reason to import — `this.providers.get('dlq')`/`this.providers.get(DLQProvider)` is
// the correct, permanent access pattern, same as `auth`/`notifications`.
registerCoreProviderSlot('dlq', ZanixCoreDLQProvider, {
  sourcePackage: '@zanix/datamaster/core',
})

/**
 * Core DLQ provider loader for Zanix.
 *
 * This module automatically registers the default DLQ provider (`DLQProvider`) under the `'dlq'`
 * core-provider slot, so it's resolvable via `this.providers.get('dlq')`/`this.providers.get(
 * DLQProvider)` without requiring manual `@Provider` setup. Still requires `registerDLQModel()` to
 * have run once during the app's own bootstrap, to make the underlying Mongo model resolvable.
 *
 * @requires ZanixCoreDLQProvider
 * @decorator Provider
 *
 * @module
 */
const zanixDLQProviderCore: void = registerProvider()

export default zanixDLQProviderCore
