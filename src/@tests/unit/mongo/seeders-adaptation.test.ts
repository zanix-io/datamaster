import { assertEquals, assertThrows } from '@std/assert'
import { seederAdaptation } from 'database/utils/seeders/adaptation.ts'
import { InternalError } from '@zanix/errors'

Deno.test('seederAdaptation throws for a database type with no processor implemented', () => {
  // Specifically `InternalError`, not just any `Error` — locks in the fix that replaced a plain
  // `Error` here (a package capability gap, not something the caller could have validated ahead
  // of time).
  const error = assertThrows(
    () =>
      seederAdaptation(
        [function Seeder() {}],
        { name: 'test' },
        'sqlite' as never,
      ),
    InternalError,
    'Not implemented',
  )
  assertEquals(error.code, 'SEEDER_TYPE_NOT_IMPLEMENTED')
})
