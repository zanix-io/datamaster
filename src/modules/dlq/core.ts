/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { DlqProvider, ZanixCoreDlqProvider } from './dlq.provider.ts'
import { Provider, registerCoreProviderSlot } from '@zanix/server'

/**
 * Provider DSL definition — applies the decorator directly to `DlqProvider` (calling it as a plain
 * function, not `@Provider(...)` syntax) rather than wrapping it in a throwaway anonymous subclass,
 * so `this.providers.get(DlqProvider)` — the class every consumer actually imports — resolves
 * correctly. See `@zanix/auth`'s `providers/core.ts` for the full rationale.
 */
// Exported (not just auto-run below) — kept consistent with every other `core.ts` loader's own
// callable, re-invokable registration function across the Zanix ecosystem (see `storage/core.ts`'s
// own `registerS3Connector` doc for the full reasoning that pattern exists for).
export const registerDlqProvider = (): void => {
  Provider({ slot: 'dlq' })(DlqProvider)
}

// `@zanix/datamaster` owns the `'dlq'` core-provider slot — registered unconditionally here,
// mirroring `@zanix/auth`'s own `'auth'` slot registration (`auth/src/modules/providers/core.ts`).
// No dedicated `this.dlq` getter on `CoreBaseClass`: unlike the 6 foundational slots (`cache`,
// `database`, ...), typing one here would require `@zanix/server` to gain new domain knowledge it
// has no other reason to import — `this.providers.get('dlq')`/`this.providers.get(DlqProvider)` is
// the correct, permanent access pattern, same as `auth`/`notifications`.
registerCoreProviderSlot('dlq', ZanixCoreDlqProvider, {
  sourcePackage: '@zanix/datamaster/core',
})

/** @deprecated Use {@link registerDlqProvider} instead — this alias will be removed in a future
 * major release. */
export const registerDLQProvider = registerDlqProvider

/**
 * Core DLQ provider loader for Zanix.
 *
 * This module automatically registers the default DLQ provider (`DlqProvider`) under the `'dlq'`
 * core-provider slot, so it's resolvable via `this.providers.get('dlq')`/`this.providers.get(
 * DlqProvider)` without requiring manual `@Provider` setup. Still requires `registerDlqModel()` to
 * have run once during the app's own bootstrap, to make the underlying Mongo model resolvable.
 *
 * @requires ZanixCoreDlqProvider
 * @decorator Provider
 *
 * @module
 */
const zanixDlqProviderCore: void = registerDlqProvider()

export default zanixDlqProviderCore
