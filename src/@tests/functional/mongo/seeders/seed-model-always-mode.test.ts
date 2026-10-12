import { assertEquals, assertStringIncludes } from '@std/assert'
import { ignore, sanitize } from '../../../(setup)/mongo/connector.ts'

const script = new URL('./seed-always-boot.ts', import.meta.url).pathname

/** One start of the connector, as its own process; returns everything it printed. */
async function start(mode: 'boot' | 'inspect'): Promise<string> {
  const { stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--minimum-dependency-age=0', script, mode],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  const decoder = new TextDecoder()
  return decoder.decode(stdout) + decoder.decode(stderr)
}

Deno.test({
  ...sanitize,
  name:
    'a seeder in runningMode "always" runs on every start and its tracking record is replaced, not rejected',
  fn: async () => {
    // Three separate starts: from the second on, recording `{name, version, status}` again used to hit
    // the tracking model's unique index and log an error on every start.
    const outputs = [await start('boot'), await start('boot'), await start('inspect')]

    for (const output of outputs) {
      assertEquals(output.includes('registering the seeder process'), false, output.slice(0, 600))
    }
    assertStringIncludes(outputs[2], 'TRACKING_RECORDS=1')
  },
  ignore,
})
