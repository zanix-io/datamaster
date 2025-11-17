import type { ZanixRedisConnector } from './mod.ts'

/**
 * Returns all keys currently stored in the redis cache.
 * Uses SCAN for efficiency instead of KEYS, so it works well with large datasets.
 */
export async function scanKeys<K extends string, V>(
  this: ZanixRedisConnector<K, V>,
  match = '*',
  _cursor = '0',
  _acc: K[] = [],
): Promise<K[]> {
  const client = await this.getClient()
  const result = await client.scan(_cursor, { MATCH: match, COUNT: 100 })

  // Remove namespace prefix
  _acc.push(...result.keys as K[])

  // Recurse if cursor is not '0'
  return result.cursor === '0'
    ? _acc
    : scanKeys.call(this, match, result.cursor, _acc) as unknown as K[]
}
