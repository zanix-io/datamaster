import { assertEquals } from '@std/assert'
import { sanitizeConnectionUri } from 'utils/sanitize-uri.ts'

/**
 * Regression coverage for a confirmed risk: a malformed/unescaped `MONGO_URI`/`REDIS_URI` throws
 * with the full connection string — credentials included — embedded verbatim in `error.message`.
 * `@zanix/logger` redacts by field name only, so that string reaches the log unredacted unless a
 * connector sanitizes it first — see the Mongo/Redis connectors' own `initialize()`/`'error'`
 * handler.
 */

Deno.test('sanitizeConnectionUri: strips a user:password@ pair from a Mongo URI', () => {
  assertEquals(
    sanitizeConnectionUri('mongodb://admin:S3cr3t@cluster0.mongodb.net/db'),
    'mongodb://[REDACTED]@cluster0.mongodb.net/db',
  )
})

Deno.test('sanitizeConnectionUri: strips credentials embedded in a full error message', () => {
  const message = 'Invalid connection string "mongodb://user:P@ssw0rd@cluster0.mongodb.net/db"'
  const sanitized = sanitizeConnectionUri(message)
  assertEquals(sanitized.includes('P@ssw0rd'), false)
  assertEquals(
    sanitized,
    'Invalid connection string "mongodb://[REDACTED]@cluster0.mongodb.net/db"',
  )
})

Deno.test('sanitizeConnectionUri: strips a redis:// credential too', () => {
  assertEquals(
    sanitizeConnectionUri('redis://default:hunter2@redis.internal:6379'),
    'redis://[REDACTED]@redis.internal:6379',
  )
})

Deno.test('sanitizeConnectionUri: a URI with no credentials passes through unchanged', () => {
  const uri = 'mongodb://cluster0.mongodb.net/db'
  assertEquals(sanitizeConnectionUri(uri), uri)
})

Deno.test('sanitizeConnectionUri: ordinary text with no embedded URI is unchanged', () => {
  const text = 'connection refused'
  assertEquals(sanitizeConnectionUri(text), text)
})

Deno.test('sanitizeConnectionUri: strips every occurrence, more than one embedded URI', () => {
  const text = 'primary mongodb://a:b@host1/db, fallback mongodb://c:d@host2/db'
  const sanitized = sanitizeConnectionUri(text)
  assertEquals(sanitized.includes('a:b@'), false)
  assertEquals(sanitized.includes('c:d@'), false)
  assertEquals(
    sanitized,
    'primary mongodb://[REDACTED]@host1/db, fallback mongodb://[REDACTED]@host2/db',
  )
})
