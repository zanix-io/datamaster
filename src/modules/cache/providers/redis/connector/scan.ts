import type { ZanixRedisConnector } from './mod.ts'
import type { RedisClientType } from 'redis'

/**
 * Returns all keys currently stored in the cache (without the namespace prefix).
 * Uses SCAN for efficiency instead of KEYS, so it works well with large datasets.
 */
export async function scanKeys<K extends string, V>(
  this: ZanixRedisConnector<K, V>,
  client: RedisClientType,
  cursor = '0',
  acc: K[] = [],
): Promise<K[]> {
  const result = await client.scan(cursor, { MATCH: `${this.namespace}:*`, COUNT: 100 })

  // Remove namespace prefix
  const realKeys = result.keys.map((k) => k.replace(`${this.namespace}:`, '') as K)
  acc.push(...realKeys)

  // Recurse if cursor is not '0'
  return result.cursor === '0' ? acc : this['scanKeys'](client, result.cursor, acc)
}
