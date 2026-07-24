import { assertEquals } from '@std/assert'
import { scanKeys } from 'cache/providers/redis/connector/scan.ts'

Deno.test('scanKeys recurses until the cursor returns to "0"', async () => {
  const responses = [
    { cursor: '1', keys: ['a', 'b'] },
    { cursor: '2', keys: ['c'] },
    { cursor: '0', keys: ['d'] },
  ]
  let call = 0

  const fakeConnector = {
    getClient: () =>
      Promise.resolve({
        scan: (_cursor: string, _opts: unknown) => Promise.resolve(responses[call++]),
      }),
  }

  const keys = await scanKeys.call(fakeConnector as never)

  assertEquals(keys, ['a', 'b', 'c', 'd'])
  assertEquals(call, 3)
})
