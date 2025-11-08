import { assertEquals } from 'jsr:@std/assert@0.224/assert-equals'
import ProgramModule from 'modules/program/public.ts'
import { assert } from 'node:console'
import { defineModelHOC } from 'modules/database/hocs/models.ts'

Deno.test('Model HOC should charge correctly', () => {
  defineModelHOC({
    name: 'test-basic-hoc',
    definition: { name: String },
    extensions: {
      seeders: [function seeder() {}],
    },
  })

  const { seeders, models } = ProgramModule.getMetadata()

  assert(models.length)
  assertEquals(models[0].name, 'test-basic-hoc')

  assert(seeders.length)
  assertEquals(seeders[0].model, 'test-basic-hoc')
  assertEquals(seeders[0].handlers.length, 1)

  ProgramModule.deleteMetadata('models')
  ProgramModule.deleteMetadata('seeders')

  const metadata = ProgramModule.getMetadata()

  assert(!metadata.models.length)
  assert(!metadata.seeders.length)
})
