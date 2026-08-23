import { InternalError } from '@zanix/errors'

/** Memcached's own key constraints (protocol spec, not a Zanix choice). */
const MAX_KEY_LENGTH = 250
// deno-lint-ignore no-control-regex
const INVALID_KEY_CHARS = /[\x00-\x20\x7f]/

/** Above this many seconds, Memcached's `exptime` argument is interpreted as an absolute Unix timestamp instead of a relative offset. */
const RELATIVE_EXPTIME_CEILING_SECONDS = 60 * 60 * 24 * 30 // 30 days

/**
 * Validates a cache key against the classic Memcached protocol's own constraints before it's
 * interpolated into a raw command line sent over the wire.
 *
 * This isn't just a protocol nicety: because commands are framed as newline-terminated ASCII
 * text with no length-prefixing, a key containing `\r\n` would let its value smuggle an extra,
 * attacker-controlled command onto the same connection — the same class of injection
 * `assertNoCrlf` (`@zanix/notifications`, SMTP headers) guards against, applied here to a
 * different protocol and kept package-local per the same single-consumer-until-proven-otherwise
 * placement rule (no real second consumer for a Memcached-specific key validator today).
 *
 * @throws {InternalError} If the key is empty, exceeds 250 bytes, or contains a space/control
 * character (including `\r`/`\n`).
 */
export function assertValidMemcachedKey(key: string): void {
  const byteLength = new TextEncoder().encode(key).length
  if (!key || byteLength > MAX_KEY_LENGTH || INVALID_KEY_CHARS.test(key)) {
    throw new InternalError(`Invalid Memcached key: ${JSON.stringify(key)}`, {
      code: 'MEMCACHED_INVALID_KEY',
      meta: {
        suggestion:
          'Memcached keys must be 1-250 bytes and contain no spaces or control characters (including CR/LF)',
        source: 'zanix',
      },
    })
  }
}

/**
 * Converts a TTL in seconds into the `exptime` value Memcached's `set` command expects: `0` means
 * "never expires", any value up to 30 days is sent as-is (relative to now), and anything beyond
 * that is converted to an absolute Unix timestamp — per the protocol's own documented rule for
 * disambiguating relative vs. absolute expiry.
 */
export function toMemcachedExptime(ttlSeconds: number): number {
  if (ttlSeconds <= 0) return 0
  if (ttlSeconds > RELATIVE_EXPTIME_CEILING_SECONDS) {
    return Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds)
  }
  return Math.floor(ttlSeconds)
}

/**
 * Races `promise` against a timer, rejecting with an `InternalError` (`MEMCACHED_CONNECTION_TIMEOUT`)
 * if `ms` elapses first. Used both for the initial TCP connect and, in
 * `ZanixMemcachedConnector`, to bound how long a command waits on `isReady` — otherwise a command
 * issued before the connector finishes connecting would wait out the base class's own internal
 * `initialize()` retry loop (up to its `timeoutConnection`, 10s by default) instead of failing
 * fast.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new InternalError(message, {
          code: 'MEMCACHED_CONNECTION_TIMEOUT',
          meta: {
            suggestion: 'Check the Memcached host/port and network connectivity',
            source: 'zanix',
          },
        }),
      )
    }, ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A minimal buffered reader/writer over a raw TCP socket, framing the classic Memcached ASCII
 * protocol: newline-terminated (`\r\n`) command/reply lines, plus fixed-length binary data blocks
 * for `set`/`get`.
 */
class MemcachedSocket {
  #conn?: Deno.TcpConn
  #buffer = new Uint8Array(0)
  readonly #encoder = new TextEncoder()
  readonly #decoder = new TextDecoder()

  /** Whether the underlying TCP connection is currently open. */
  public get connected(): boolean {
    return this.#conn !== undefined
  }

  /** Opens the TCP connection, failing after `timeoutMs` if it never completes. */
  public async connect(hostname: string, port: number, timeoutMs: number): Promise<void> {
    this.#conn = await withTimeout(
      Deno.connect({ hostname, port }),
      timeoutMs,
      `Failed to connect to Memcached at ${hostname}:${port}`,
    )
    this.#buffer = new Uint8Array(0)
  }

  /** Closes the connection and discards any buffered, unread bytes. */
  public close(): void {
    try {
      this.#conn?.close()
    } catch {
      // Already closed — nothing to do.
    }
    this.#conn = undefined
    this.#buffer = new Uint8Array(0)
  }

  async #fill(): Promise<void> {
    // Defensive guard, not exercised by a test: hitting it deterministically would need `close()`
    // to run in the narrow window between two `#fill()` calls of the same in-flight read (e.g. a
    // caller closing the connector mid-command) — a real race, not something a test can force
    // without either an artificial flake or reaching into private state. A `close()` while
    // `#conn.read()` itself is pending instead surfaces as a raw Deno connection error, covered by
    // `MemcachedCache transparently reconnects after the connection is closed`.
    if (!this.#conn) {
      throw new InternalError('Memcached socket is not connected', {
        code: 'MEMCACHED_NOT_CONNECTED',
        meta: { source: 'zanix' },
      })
    }

    const chunk = new Uint8Array(4096)
    const bytesRead = await this.#conn.read(chunk)
    if (bytesRead === null) {
      this.close()
      throw new InternalError('Memcached connection closed unexpectedly', {
        code: 'MEMCACHED_CONNECTION_CLOSED',
        meta: { source: 'zanix' },
      })
    }

    const merged = new Uint8Array(this.#buffer.length + bytesRead)
    merged.set(this.#buffer)
    merged.set(chunk.subarray(0, bytesRead), this.#buffer.length)
    this.#buffer = merged
  }

  #indexOfCrlf(): number {
    for (let i = 0; i < this.#buffer.length - 1; i++) {
      if (this.#buffer[i] === 13 && this.#buffer[i + 1] === 10) return i
    }
    return -1
  }

  /** Reads and consumes one `\r\n`-terminated line, blocking on more socket reads as needed. */
  public async readLine(): Promise<string> {
    while (true) {
      const index = this.#indexOfCrlf()
      if (index !== -1) {
        const line = this.#decoder.decode(this.#buffer.subarray(0, index))
        this.#buffer = this.#buffer.slice(index + 2)
        return line
      }
      // Inherently sequential — each `#fill()` call depends on how much of the line the previous
      // one already read, so there's nothing here for `Promise.all` to parallelize.
      // deno-lint-ignore no-await-in-loop
      await this.#fill()
    }
  }

  /**
   * Reads and consumes exactly `length` bytes, plus the trailing `\r\n` Memcached always appends
   * to a data block.
   */
  public async readBytes(length: number): Promise<Uint8Array> {
    while (this.#buffer.length < length + 2) {
      // Same rationale as `readLine`'s own loop above — strictly sequential socket reads.
      // deno-lint-ignore no-await-in-loop
      await this.#fill()
    }
    const data = this.#buffer.slice(0, length)
    this.#buffer = this.#buffer.slice(length + 2)
    return data
  }

  async #write(data: Uint8Array): Promise<void> {
    if (!this.#conn) {
      throw new InternalError('Memcached socket is not connected', {
        code: 'MEMCACHED_NOT_CONNECTED',
        meta: { source: 'zanix' },
      })
    }
    let offset = 0
    while (offset < data.length) {
      // Inherently sequential — a short write's remaining offset can only be known after
      // awaiting the previous write, so there's nothing here for `Promise.all` to parallelize.
      // deno-lint-ignore no-await-in-loop
      offset += await this.#conn.write(data.subarray(offset))
    }
  }

  /** Writes a command line, appending the protocol's own `\r\n` terminator. */
  public writeLine(line: string): Promise<void> {
    return this.#write(this.#encoder.encode(`${line}\r\n`))
  }

  /** Writes a raw data block, appending the trailing `\r\n` Memcached's `set` command requires. */
  public writeData(data: Uint8Array): Promise<void> {
    const withTerminator = new Uint8Array(data.length + 2)
    withTerminator.set(data)
    withTerminator.set([13, 10], data.length)
    return this.#write(withTerminator)
  }
}

/**
 * Command-level client for the classic Memcached text protocol, over a single persistent TCP
 * connection.
 *
 * The protocol has no request IDs — replies are matched to commands purely by the order they're
 * sent/read in, so every command here runs through a FIFO queue that serializes access to the one
 * shared connection. A dropped connection is transparently reopened on the next command (one
 * attempt, not a retry-with-backoff loop — this stays deliberately simpler than
 * `ZanixRedisConnector`'s own retry engine).
 */
export class MemcachedProtocolClient {
  readonly #socket = new MemcachedSocket()
  #queue: Promise<unknown> = Promise.resolve()
  readonly #hostname: string
  readonly #port: number
  readonly #connectTimeout: number

  constructor(hostname: string, port: number, connectTimeout: number) {
    this.#hostname = hostname
    this.#port = port
    this.#connectTimeout = connectTimeout
  }

  /** Whether the underlying TCP connection is currently open. */
  public get connected(): boolean {
    return this.#socket.connected
  }

  /** Opens the initial TCP connection. */
  public connect(): Promise<void> {
    return this.#socket.connect(this.#hostname, this.#port, this.#connectTimeout)
  }

  /** Closes the underlying TCP connection. */
  public close(): void {
    this.#socket.close()
  }

  #enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(fn, fn)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #ensureConnected(): Promise<void> {
    if (!this.#socket.connected) {
      await this.#socket.connect(this.#hostname, this.#port, this.#connectTimeout)
    }
  }

  /** Sends `version`, mainly useful as a lightweight liveness probe. */
  public version(): Promise<string> {
    return this.#enqueue(async () => {
      await this.#ensureConnected()
      await this.#socket.writeLine('version')
      return this.#socket.readLine()
    })
  }

  /** Stores `value` under `key`, expiring after `exptimeSeconds` (see {@link toMemcachedExptime}). */
  public set(key: string, value: Uint8Array, exptimeSeconds: number): Promise<void> {
    assertValidMemcachedKey(key)
    return this.#enqueue(async () => {
      await this.#ensureConnected()
      await this.#socket.writeLine(`set ${key} 0 ${exptimeSeconds} ${value.length}`)
      await this.#socket.writeData(value)
      const reply = await this.#socket.readLine()
      if (reply !== 'STORED') {
        throw new InternalError(`Memcached SET failed for key '${key}': ${reply}`, {
          code: 'MEMCACHED_SET_FAILED',
          meta: { key, reply, source: 'zanix' },
        })
      }
    })
  }

  /**
   * Retrieves the raw stored bytes for `key`, or `undefined` if it doesn't exist (or has
   * expired).
   */
  public get(key: string): Promise<Uint8Array | undefined> {
    assertValidMemcachedKey(key)
    return this.#enqueue(async () => {
      await this.#ensureConnected()
      await this.#socket.writeLine(`get ${key}`)
      const header = await this.#socket.readLine()
      if (header === 'END') return undefined

      // Header shape: `VALUE <key> <flags> <bytes>`
      const bytesRaw = header.split(' ')[3]
      const data = await this.#socket.readBytes(Number(bytesRaw))
      await this.#socket.readLine() // trailing 'END'
      return data
    })
  }

  /** Deletes `key`, returning whether it actually existed. */
  public delete(key: string): Promise<boolean> {
    assertValidMemcachedKey(key)
    return this.#enqueue(async () => {
      await this.#ensureConnected()
      await this.#socket.writeLine(`delete ${key}`)
      const reply = await this.#socket.readLine()
      return reply === 'DELETED'
    })
  }

  /**
   * Flushes every key on the connected Memcached server — see `ZanixMemcachedConnector.clear()`'s
   * own caution.
   */
  public flushAll(): Promise<void> {
    return this.#enqueue(async () => {
      await this.#ensureConnected()
      await this.#socket.writeLine('flush_all')
      await this.#socket.readLine()
    })
  }
}
