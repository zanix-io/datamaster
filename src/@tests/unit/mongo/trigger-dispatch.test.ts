// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertExists } from '@std/assert'
import { ProgramModule, Provider, ZanixWorkerProvider } from '@zanix/server'
import { handleTrigger } from 'mongo/processor/triggers/dispatch.ts'
import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'

const calls: { name: string; options: any; via: 'runJob' | 'runTask' }[] = []

@Provider('worker')
class _FakeWorkerProvider extends ZanixWorkerProvider {
  public override runJob(name: string, options?: any) {
    calls.push({ name, options, via: 'runJob' })
    return true
  }
  public override runTask(name: string, options?: any) {
    calls.push({ name, options, via: 'runTask' })
    return true
  }
}

const reset = () => {
  calls.length = 0
}

Deno.test('handleTrigger dispatches "mail" to the well-known mail job name', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    mail: { to: 'a@b.com', subject: 'Hi', body: { template: 'welcome' } },
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0].name, DEFAULT_TRIGGER_JOBS.mail)
  assertEquals(calls[0].options.args.body.template, 'welcome')
  assertEquals(calls[0].options.args.to, 'a@b.com')
})

Deno.test('handleTrigger dispatches "request" to the well-known request job name', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'POST', headers: {} },
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0].name, DEFAULT_TRIGGER_JOBS.request)
  assertEquals(calls[0].options.args.url, 'http://localhost.com')
})

Deno.test('handleTrigger dispatches "custom" to the action\'s own job name', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    custom: { name: 'my-custom-job' },
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0].name, 'my-custom-job')
})

Deno.test('handleTrigger dispatches every present action on the same trigger', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    mail: { to: 'a@b.com', subject: 'Hi', body: { template: 'welcome' } },
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  assertEquals(calls.length, 2)
  assertEquals(
    new Set(calls.map((c) => c.name)),
    new Set([DEFAULT_TRIGGER_JOBS.mail, DEFAULT_TRIGGER_JOBS.request]),
  )
})

Deno.test('handleTrigger skips an action whose conditions do not pass', async () => {
  reset()

  await handleTrigger({ id: '1', bool: false }, {
    mail: {
      to: 'a@b.com',
      subject: 'Hi',
      body: { template: 'welcome' },
      conditions: [{ field: 'bool', op: '=', value: true }],
    },
  })

  assertEquals(calls.length, 0)
})

Deno.test('handleTrigger dispatches an action whose conditions do pass', async () => {
  reset()

  await handleTrigger({ id: '1', bool: true }, {
    mail: {
      to: 'a@b.com',
      subject: 'Hi',
      body: { template: 'welcome' },
      conditions: [{ field: 'bool', op: '=', value: true }],
    },
  })

  assertEquals(calls.length, 1)
})

Deno.test('handleTrigger payload carries current data under _data, without _old', async () => {
  reset()

  await handleTrigger({ id: '1', name: 'A', _old: { id: '1', name: 'Old' } }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  const { data } = calls[0].options.args
  assertEquals(data._data, { id: '1', name: 'A' })
  assertEquals(data._oldData, { id: '1', name: 'Old' })
})

Deno.test('handleTrigger payload omits _oldData when there is no previous document', async () => {
  reset()

  await handleTrigger({ id: '1', name: 'A' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  const { data } = calls[0].options.args
  assertEquals('_oldData' in data, false)
})

Deno.test('handleTrigger merges an action\'s "data" into the payload', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: {
      url: 'http://localhost.com',
      method: 'GET',
      headers: {},
      data: { extra: 'value' },
    },
  })

  assertEquals(calls[0].options.args.data.extra, 'value')
})

Deno.test('handleTrigger defaults priority to "low" when not set', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  assertEquals(calls[0].options.args.priority, 'low')
})

Deno.test('handleTrigger forwards an explicit priority', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {}, priority: 'high' },
  })

  assertEquals(calls[0].options.args.priority, 'high')
})

Deno.test('handleTrigger forwards the current ALS contextId when present', async () => {
  reset()
  ProgramModule.asyncContext.enterWith({ id: 'ctx-1' })

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  assertExists(calls[0].options.contextId)
  assertEquals(calls[0].options.contextId, 'ctx-1')
})

Deno.test('handleTrigger interpolates {{field}} placeholders against the record', async () => {
  reset()

  await handleTrigger({ id: '1', email: 'a@b.com', name: 'Ann' }, {
    mail: { to: '{{email}}', subject: 'Welcome {{name}}', body: { template: 'welcome' } },
  })

  assertEquals(calls[0].options.args.to, 'a@b.com')
  assertEquals(calls[0].options.args.subject, 'Welcome Ann')
})

Deno.test('handleTrigger interpolates nested fields like headers/body values', async () => {
  reset()

  await handleTrigger({ id: '1', apiKey: 'secret-key' }, {
    request: {
      url: 'http://localhost.com',
      method: 'POST',
      headers: { authorization: 'Bearer {{apiKey}}' },
      body: { id: '{{id}}' },
    },
  })

  assertEquals(calls[0].options.args.headers, { authorization: 'Bearer secret-key' })
  assertEquals(calls[0].options.args.body, { id: '1' })
})

Deno.test("handleTrigger preserves the record's real data type, not just strings", async () => {
  reset()

  await handleTrigger({ id: '1', amount: 42, active: true, tags: ['a', 'b'] }, {
    request: {
      url: 'http://localhost.com',
      method: 'POST',
      headers: {},
      body: { amount: '{{amount}}', active: '{{active}}', tags: '{{tags}}' },
    },
  })

  assertEquals(calls[0].options.args.body, { amount: 42, active: true, tags: ['a', 'b'] })
})

Deno.test('handleTrigger stringifies a non-string field mixed into a larger string', async () => {
  reset()

  await handleTrigger({ id: '1', amount: 42 }, {
    request: {
      url: 'http://localhost.com?value={{amount}}',
      method: 'GET',
      headers: {},
    },
  })

  assertEquals(calls[0].options.args.url, 'http://localhost.com?value=42')
})

Deno.test('handleTrigger sends no request body when the action has none configured', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  assertEquals('body' in calls[0].options.args, false)
})

Deno.test('handleTrigger converts a GET body into query params, not a fetch body', async () => {
  reset()

  await handleTrigger({ id: '1', name: 'Ann' }, {
    request: {
      url: 'http://localhost.com',
      method: 'GET',
      headers: {},
      body: { name: '{{name}}' },
    },
  })

  assertEquals('body' in calls[0].options.args, false)
  assertEquals(calls[0].options.args.url, 'http://localhost.com?name=Ann')
})

Deno.test('handleTrigger converts body into query params for DELETE too', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'DELETE', headers: {}, body: { id: '{{id}}' } },
  })

  assertEquals('body' in calls[0].options.args, false)
  assertEquals(calls[0].options.args.url, 'http://localhost.com?id=1')
})

Deno.test('handleTrigger converts body into query params for HEAD too', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'HEAD', headers: {}, body: { id: '{{id}}' } },
  })

  assertEquals('body' in calls[0].options.args, false)
  assertEquals(calls[0].options.args.url, 'http://localhost.com?id=1')
})

Deno.test('handleTrigger keeps body as a real fetch body for POST', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'POST', headers: {}, body: { id: '{{id}}' } },
  })

  assertEquals(calls[0].options.args.body, { id: '1' })
  assertEquals(calls[0].options.args.url, 'http://localhost.com')
})

Deno.test('handleTrigger keeps body as a real fetch body for PUT', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'PUT', headers: {}, body: { id: '{{id}}' } },
  })

  assertEquals(calls[0].options.args.body, { id: '1' })
  assertEquals(calls[0].options.args.url, 'http://localhost.com')
})

Deno.test('handleTrigger keeps body as a real fetch body for PATCH', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'PATCH', headers: {}, body: { id: '{{id}}' } },
  })

  assertEquals(calls[0].options.args.body, { id: '1' })
  assertEquals(calls[0].options.args.url, 'http://localhost.com')
})

Deno.test('handleTrigger appends converted body params to an existing query string', async () => {
  reset()

  await handleTrigger({ id: '1' }, {
    request: {
      url: 'http://localhost.com?page=1',
      method: 'GET',
      headers: {},
      body: { id: '{{id}}' },
    },
  })

  assertEquals(calls[0].options.args.url, 'http://localhost.com?page=1&id=1')
})

Deno.test('handleTrigger expands an array body field into repeated GET query keys', async () => {
  reset()

  await handleTrigger({ id: '1', tags: ['a', 'b'] }, {
    request: {
      url: 'http://localhost.com',
      method: 'GET',
      headers: {},
      body: { tags: '{{tags}}' },
    },
  })

  assertEquals(calls[0].options.args.url, 'http://localhost.com?tags=a&tags=b')
})

Deno.test('handleTrigger dispatches via runTask when AMQP_URI is not configured', async () => {
  reset()
  Deno.env.delete('AMQP_URI')

  await handleTrigger({ id: '1' }, {
    request: { url: 'http://localhost.com', method: 'GET', headers: {} },
  })

  assertEquals(calls[0].via, 'runTask')
  assertEquals('settings' in calls[0].options, false)
})

Deno.test('handleTrigger dispatches via runJob when AMQP_URI is configured', async () => {
  reset()
  Deno.env.set('AMQP_URI', 'amqp://localhost')

  try {
    await handleTrigger({ id: '1' }, {
      request: { url: 'http://localhost.com', method: 'GET', headers: {}, priority: 'high' },
    })

    assertEquals(calls[0].via, 'runJob')
    assertEquals(calls[0].options.settings.priority, 'high')
  } finally {
    Deno.env.delete('AMQP_URI')
  }
})
