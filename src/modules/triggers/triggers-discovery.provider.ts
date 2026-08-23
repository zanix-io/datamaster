import type { DiscoveryProvider } from '@zanix/server'
import type { TriggersModelAttrs } from 'database/mod.ts'

import { ProgramModule } from '@zanix/server'
import { TriggersAdminRepository } from './triggers.repository.ts'

/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/triggers` — see `@zanix/server`'s
 * `docs/handlers.md`'s "Discovery" section. `@zanix/admin`'s `defineAdminMetadata` registers it via
 * `ProgramModule.defineDiscovery` alongside composing `createTriggersAdminController`; this package
 * only authors the provider, since it's the actual owner of the persisted triggers collection this
 * reuses `TriggersAdminRepository.list()` to read.
 *
 * `TriggersAdminRepository` is resolved fresh on every `snapshot()` call (never cached at
 * construction time here) — deferring DI resolution to request time, well after boot, rather than
 * to whenever this factory itself happens to run during composition, before the underlying Mongo
 * connector is necessarily ready.
 */
export function createTriggersDiscoveryProvider(): DiscoveryProvider<
  TriggersModelAttrs
> {
  return {
    snapshot: () => ProgramModule.providers.get(TriggersAdminRepository).list(),
  }
}
