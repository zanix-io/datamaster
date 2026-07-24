import { assertThrows } from '@std/assert'
import { seederAdaptation } from 'database/utils/seeders/adaptation.ts'

Deno.test('seederAdaptation throws for database types with no processor implementation yet', () => {
  assertThrows(
    () => seederAdaptation([function Seeder() {}], { name: 'test' }, 'postgress' as never),
    Error,
    'Not implemented',
  )
})
