// deno-coverage-ignore-file

import { dirname } from 'jsr:@std/path@0.217/dirname'
import { fromFileUrl } from 'jsr:@std/path@0.217/from_file_url'
import { join } from 'jsr:@std/path@0.217/join'

export async function loadDotEnvTest(): Promise<void> {
  let content: string
  try {
    content = await Deno.readTextFile(
      join(dirname(fromFileUrl(import.meta.url)), '..', '.env.test'),
    )
  } catch {
    return
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !Deno.env.has(key)) Deno.env.set(key, value)
  }
}

loadDotEnvTest()
