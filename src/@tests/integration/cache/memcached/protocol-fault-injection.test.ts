// A fake, fully-controlled Memcached server (`Deno.listen`) — not the real one this package's
// other Memcached integration tests talk to — used specifically to trigger protocol-level error
// branches a real, well-behaved Memcached server never actually exercises: a rejected `SET` reply
// and a connection dropped mid-response. Binds a real socket, so this belongs in `integration/`
// per `zanix-test-tier-conventions` (Pattern B), never `unit/`.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { ZanixMemcachedConnector } from 'modules/cache/providers/memcached/connector/mod.ts'

console.info = () => {}
console.error = () => {}
console.warn = () => {}

/**
 * Accepts exactly one connection and hands it to `handle`, which owns the connection's lifecycle
 * from there (when to close it, and how) — a forced `conn.close()` here regardless of what
 * `handle` already did to the socket would risk turning a deliberate graceful half-close into a
 * hard reset (see the `closeWrite()` test below). Leaked resources are fine: every test using
 * this sets `sanitizeResources: false`.
 */
function withFakeServer(
  handle: (conn: Deno.Conn) => Promise<void> | void,
): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const port = (listener.addr as Deno.NetAddr).port
  ;(async () => {
    const conn = await listener.accept()
    await handle(conn)
    listener.close()
  })()

  return port
}

/** Reads and discards bytes until a full `\r\n`-terminated command line has arrived. */
async function drainOneLine(conn: Deno.Conn): Promise<void> {
  const decoder = new TextDecoder()
  const buf = new Uint8Array(4096)
  let seen = ''
  while (!seen.includes('\r\n')) {
    // Each read depends on the previous one having arrived — genuinely sequential, not a batch of
    // independent promises `Promise.all` could run concurrently.
    // deno-lint-ignore no-await-in-loop
    const n = await conn.read(buf)
    if (n === null) return
    seen += decoder.decode(buf.subarray(0, n))
  }
}

Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'MemcachedCache surfaces MEMCACHED_SET_FAILED when the server rejects a SET',
  fn: async () => {
    const port = withFakeServer(async (conn) => {
      // The command line and the data block may arrive as separate reads — drain until the
      // trailing data-block CRLF has been seen before replying.
      const decoder = new TextDecoder()
      let seen = ''
      const buf = new Uint8Array(4096)
      while (!seen.includes('\r\n', seen.indexOf('\r\n') + 1)) {
        // Same sequential-read reasoning as `drainOneLine` above.
        // deno-lint-ignore no-await-in-loop
        const n = await conn.read(buf)
        if (n === null) break
        seen += decoder.decode(buf.subarray(0, n))
      }
      await conn.write(new TextEncoder().encode('SERVER_ERROR out of memory\r\n'))
      conn.close()
    })

    const cache = new ZanixMemcachedConnector<string, number>({ memcachedUri: `127.0.0.1:${port}` })
    await cache.isReady

    const error = await assertRejects(() => cache.set('x', 1), InternalError)
    assertEquals(error.code, 'MEMCACHED_SET_FAILED')

    cache['close']()
  },
})

Deno.test({
  sanitizeResources: false,
  sanitizeOps: false,
  name: 'MemcachedCache surfaces MEMCACHED_CONNECTION_CLOSED when the server drops mid-reply',
  fn: async () => {
    const port = withFakeServer(async (conn) => {
      // Drain the `get <key>` command line first — leaving it unread and then closing would
      // surface as a raw `ConnectionReset` (unread data forces a hard reset on close), not the
      // graceful EOF this test targets. Half-close the write side afterward (a clean FIN) without
      // ever replying — the client's next `#fill()` inside `readLine()` then sees `bytesRead ===
      // null` instead of a header line.
      await drainOneLine(conn)
      conn.closeWrite()
    })

    const cache = new ZanixMemcachedConnector<string, number>({ memcachedUri: `127.0.0.1:${port}` })
    await cache.isReady

    const error = await assertRejects(() => cache.get('key'), InternalError)
    assertEquals(error.code, 'MEMCACHED_CONNECTION_CLOSED')
    assert(!cache.isHealthy()) // the failed read also closes the socket on the client side

    cache['close']()
  },
})
