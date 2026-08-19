import { assertEquals, assertExists } from '@std/assert'
import {
  DEFAULT_FILE_MODEL,
  FILE_MODEL_ENV,
  fileModelName,
  registerFileModel,
} from 'modules/files/files.model.ts'
import ProgramModule from 'modules/program/mod.ts'

const withEnv = (env: string, value: string | undefined, fn: () => void) => {
  const previous = Deno.env.get(env)
  if (value === undefined) Deno.env.delete(env)
  else Deno.env.set(env, value)
  try {
    fn()
  } finally {
    if (previous === undefined) Deno.env.delete(env)
    else Deno.env.set(env, previous)
  }
}

Deno.test('fileModelName defaults to zanix-files', () => {
  withEnv(FILE_MODEL_ENV, undefined, () => {
    assertEquals(fileModelName(), DEFAULT_FILE_MODEL)
  })
})

Deno.test('fileModelName honors FILE_MODEL_NAME', () => {
  withEnv(FILE_MODEL_ENV, 'custom-files', () => {
    assertEquals(fileModelName(), 'custom-files')
  })
})

Deno.test('registerFileModel registers a model resolvable under fileModelName()', () => {
  ProgramModule.models.deleteModels('mongo')
  registerFileModel()

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === fileModelName())
  assertExists(registered)

  ProgramModule.models.deleteModels('mongo')
  registerFileModel() // reset the module-level cache for later tests in this file
})

Deno.test('registerFileModel declares the generic file record shape', () => {
  ProgramModule.models.deleteModels('mongo')
  registerFileModel()

  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === fileModelName())
  // deno-lint-ignore no-explicit-any
  const definition = registered?.definition as any
  assertEquals(definition._id.type, String)
  assertEquals(definition._id.required, true)
  assertEquals(definition.key.type, String)
  assertEquals(definition.key.required, true)
  assertEquals(definition.contentType.type, String)
  assertEquals(definition.size.type, Number)
  assertEquals(definition.checksum.type, String)
  assertEquals(definition.filename.type, String)
  assertEquals(definition.filename.required, undefined)
  assertEquals(definition.metadata.type, Object)
  // deno-lint-ignore no-explicit-any
  assertEquals((registered?.options as any)?.timestamps, true)

  ProgramModule.models.deleteModels('mongo')
  registerFileModel() // reset the module-level cache for later tests in this file
})

Deno.test('registerFileModel: modelName option overrides the collection name', () => {
  ProgramModule.models.deleteModels('mongo')
  registerFileModel({ modelName: 'app-files' })

  assertEquals(fileModelName(), 'app-files')
  const registered = ProgramModule.models.getModels('mongo').find((m) => m.name === 'app-files')
  assertExists(registered)

  ProgramModule.models.deleteModels('mongo')
  registerFileModel() // reset the module-level cache for later tests in this file
})

Deno.test('registerFileModel: FILE_MODEL_NAME env var overrides the modelName option', () => {
  withEnv(FILE_MODEL_ENV, 'env-files', () => {
    ProgramModule.models.deleteModels('mongo')
    registerFileModel({ modelName: 'app-files' })

    assertEquals(fileModelName(), 'env-files')

    ProgramModule.models.deleteModels('mongo')
  })
  registerFileModel() // reset the module-level cache for later tests in this file
})

Deno.test("registerFileModel: a later call without modelName doesn't leak a prior value", () => {
  ProgramModule.models.deleteModels('mongo')
  registerFileModel({ modelName: 'app-files' })
  assertEquals(fileModelName(), 'app-files')

  ProgramModule.models.deleteModels('mongo')
  registerFileModel() // no modelName this time
  assertEquals(fileModelName(), DEFAULT_FILE_MODEL)

  ProgramModule.models.deleteModels('mongo')
})
