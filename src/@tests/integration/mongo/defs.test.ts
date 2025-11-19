import { assertEquals } from 'jsr:@std/assert@0.224/assert-equals'
import ProgramModule from 'modules/program/public.ts'
import { assert } from 'node:console'
import { registerModel } from 'modules/database/defs/models.ts'

Deno.test('Model DSL should charge correctly', () => {
  registerModel({
    name: 'test-basic-dsl',
    definition: { name: String },
    extensions: {
      seeders: [function seeder() {}],
    },
  })

  const { seeders, models } = ProgramModule.getMetadata()

  assert(models.length)
  assertEquals(models[0].name, 'test-basic-dsl')

  assert(seeders.length)
  assertEquals(seeders[0].model, 'test-basic-dsl')
  assertEquals(seeders[0].handlers.length, 1)

  ProgramModule.deleteMetadata('models')
  ProgramModule.deleteMetadata('seeders')

  const metadata = ProgramModule.getMetadata()

  assert(!metadata.models.length)
  assert(!metadata.seeders.length)
})
