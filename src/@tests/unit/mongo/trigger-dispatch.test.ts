// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertExists } from '@std/assert'
import {
  ProgramModule,
  Provider,
  registerCoreProviderSlot,
  ZanixWorkerProvider,
} from '@zanix/server'
import { handleTrigger } from 'mongo/processor/triggers/dispatch.ts'
import { DEFAULT_TRIGGER_JOBS } from 'database/typings/triggers.ts'
import { registerTriggerActionJob } from 'database/defs/trigger-actions.ts'
import DatabaseProgramModule from 'modules/program/mod.ts'

const calls: { name: string; options: any; via: 'runJob' | 'runTask' }[] = []

// `'worker'` is owned by `@zanix/asyncmq`, which this package's tests don't depend on — must be
// registered here explicitly before decorating a fixture for it, or the decorator throws (a
// reserved core slot that isn't registered yet); see `zanix-libraries-architecture` skill's
// registration-order rule.
registerCoreProviderSlot('worker', ZanixWorkerProvider)

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

Deno.test({
  name: 'handleTrigger dispatches "mail" to a registered override job name, not the default',
  fn: async () => {
    reset()

    registerTriggerActionJob('mail', { name: 'custom-mail-job', handler: () => {} })

    try {
      await handleTrigger({ id: '1' }, {
        mail: { to: 'a@b.com', subject: 'Hi', body: { template: 'welcome' } },
      })

      assertEquals(calls.length, 1)
      assertEquals(calls[0].name, 'custom-mail-job')
    } finally {
      DatabaseProgramModule.triggerActionJobs.resetContainer()
    }
  },
})

Deno.test(
  'handleTrigger interpolates placeholders inside a nested "data" object',
  async () => {
    reset()

    Deno.env.set('ADMIN_SERVER_ID', 'srv-42')

    try {
      await handleTrigger({ firstName: 'pepe', click: 'click here' }, {
        mail: {
          to: 'email@email.io',
          subject: 'Hola {{firstName}}',
          zanixTemplate: 'welcome',
          data: {
            buttonText: '{{click}} ${{ADMIN_SERVER_ID}}',
            other: [{ text: '{{click}}' }],
          },
          other: [{ text: '{{click}}' }],
        },
      })

      assertEquals(calls[0].options.args.subject, 'Hola pepe')
      assertEquals(calls[0].options.args.data.buttonText, 'click here srv-42')
      assertEquals(calls[0].options.args.data.other[0].text, 'click here')
      assertEquals(calls[0].options.args.other[0].text, 'click here')
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
    }
  },
)

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

Deno.test('handleTrigger resolves a ${{ENV_VAR}} placeholder against an existing var', async () => {
  reset()
  Deno.env.set('TEST_API_TOKEN', '123')

  try {
    await handleTrigger({ id: '1' }, {
      request: {
        url: 'http://localhost.com',
        method: 'POST',
        headers: { authorization: 'Bearer ${{TEST_API_TOKEN}}' },
      },
    })

    assertEquals(calls[0].options.args.headers, { authorization: 'Bearer 123' })
  } finally {
    Deno.env.delete('TEST_API_TOKEN')
  }
})

Deno.test('handleTrigger resolves ${{ENV_VAR}} to "undefined" when the var is unset', async () => {
  reset()
  Deno.env.delete('TEST_MISSING_TOKEN')

  await handleTrigger({ id: '1' }, {
    request: {
      url: 'http://localhost.com',
      method: 'POST',
      headers: { authorization: 'Bearer ${{TEST_MISSING_TOKEN}}' },
    },
  })

  assertEquals(calls[0].options.args.headers, { authorization: 'Bearer undefined' })
})

Deno.test('handleTrigger resolves ${{ENV_VAR}} in the url, after model interpolation', async () => {
  reset()
  Deno.env.set('TEST_WEBHOOK_URL', 'https://hooks.example.com/user-updated')

  try {
    await handleTrigger({ id: '1', name: 'Ann' }, {
      request: {
        url: '${{TEST_WEBHOOK_URL}}?name={{name}}',
        method: 'GET',
        headers: {},
      },
    })

    assertEquals(calls[0].options.args.url, 'https://hooks.example.com/user-updated?name=Ann')
  } finally {
    Deno.env.delete('TEST_WEBHOOK_URL')
  }
})

Deno.test('handleTrigger resolves ${{ENV_VAR}} inside nested body/data fields', async () => {
  reset()
  Deno.env.set('TEST_API_URL', 'https://api.example.com')

  try {
    await handleTrigger({ id: '1' }, {
      request: {
        url: 'http://localhost.com',
        method: 'POST',
        headers: {},
        body: { apiUrl: '${{TEST_API_URL}}' },
      },
    })

    assertEquals(calls[0].options.args.body, { apiUrl: 'https://api.example.com' })
  } finally {
    Deno.env.delete('TEST_API_URL')
  }
})

Deno.test('handleTrigger keeps {{field}} and ${{ENV_VAR}} independent in one trigger', async () => {
  reset()
  Deno.env.set('TEST_WEBHOOK_TOKEN', 'secret-token')

  try {
    await handleTrigger({ id: '1', email: 'a@b.com' }, {
      request: {
        url: 'http://localhost.com',
        method: 'POST',
        headers: { authorization: 'Bearer ${{TEST_WEBHOOK_TOKEN}}' },
        body: { email: '{{email}}' },
      },
    })

    assertEquals(calls[0].options.args.headers, { authorization: 'Bearer secret-token' })
    assertEquals(calls[0].options.args.body, { email: 'a@b.com' })
  } finally {
    Deno.env.delete('TEST_WEBHOOK_TOKEN')
  }
})

Deno.test('handleTrigger resolves ${{ENV_VAR}} for "mail" too, not just "request"', async () => {
  reset()
  Deno.env.set('TEST_MAIL_FROM', 'noreply@example.com')

  try {
    await handleTrigger({ id: '1', email: 'a@b.com' }, {
      mail: {
        to: '{{email}}',
        subject: 'Hi',
        from: '${{TEST_MAIL_FROM}}',
        body: { template: 'welcome' },
      },
    })

    assertEquals(calls[0].options.args.from, 'noreply@example.com')
    assertEquals(calls[0].options.args.to, 'a@b.com')
  } finally {
    Deno.env.delete('TEST_MAIL_FROM')
  }
})

Deno.test('handleTrigger resolves ${{ENV_VAR}} in "custom" fields too', async () => {
  reset()
  Deno.env.set('TEST_CUSTOM_VALUE', 'resolved-value')

  try {
    await handleTrigger({ id: '1' }, {
      custom: { name: '${{TEST_CUSTOM_VALUE}}' },
    })

    // The dispatched job name is picked from the raw, uninterpolated `name` (a pre-existing
    // characteristic of `jobNameFor`, unrelated to env interpolation) — but the interpolated
    // value still lands in the payload's own `args.name`, proving the same pass ran for `custom`.
    assertEquals(calls[0].options.args.name, 'resolved-value')
  } finally {
    Deno.env.delete('TEST_CUSTOM_VALUE')
  }
})
