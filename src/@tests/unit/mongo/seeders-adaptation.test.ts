import { assertThrows } from '@std/assert'
import { seederAdaptation } from 'database/utils/seeders/adaptation.ts'

Deno.test('seederAdaptation throws for a database type with no processor implemented', () => {
  assertThrows(
    () =>
      seederAdaptation(
        [function Seeder() {}],
        { name: 'test' },
        'sqlite' as never,
      ),
    Error,
    'Not implemented',
  )
})
