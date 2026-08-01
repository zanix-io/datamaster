import { assertEquals } from '@std/assert'
import { TriggersAdminService } from 'modules/triggers/triggers.service.ts'
import type { TriggersAdminRepository } from 'modules/triggers/triggers.repository.ts'

function fakeService(repository: Partial<TriggersAdminRepository>) {
  const instance = Object.create(TriggersAdminService.prototype)
  Object.defineProperty(instance, 'providers', {
    value: { get: () => repository },
  })
  return instance
}

Deno.test('TriggersAdminService delegates every method to the repository', async () => {
  const calls: unknown[] = []
  const repository: Partial<TriggersAdminRepository> = {
    list: () => (calls.push(['list']), Promise.resolve([])) as never,
    get: (model) => (calls.push(['get', model]), Promise.resolve({} as never)),
    create: (input) => (
      calls.push(['create', input]), Promise.resolve({} as never)
    ),
    update: (
      model,
      changes,
    ) => (calls.push(['update', model, changes]), Promise.resolve({} as never)),
    remove: (model) => (calls.push(['remove', model]), Promise.resolve()),
  }
  const service: TriggersAdminService = fakeService(repository)

  await service.list()
  await service.get('users')
  await service.create({ model: 'users', active: true, triggers: {} })
  await service.update('users', { active: false })
  await service.remove('users')

  assertEquals(calls, [
    ['list'],
    ['get', 'users'],
    ['create', { model: 'users', active: true, triggers: {} }],
    ['update', 'users', { active: false }],
    ['remove', 'users'],
  ])
})
