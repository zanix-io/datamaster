/**
 * A generic in-memory buffer that flushes whichever threshold is reached first: `maxSize` items
 * accumulated, or `flushIntervalMs` elapsed since the first item in the current batch. Used by
 * `elasticsearchLogSave` to turn one HTTP round trip per log call into periodic `_bulk` writes,
 * but intentionally has no knowledge of Elasticsearch/OpenSearch or logs — it's a plain
 * size/time flush policy, reusable for any batched write.
 *
 * Buffered-but-unflushed items are lost if the process exits abruptly before the next flush —
 * an accepted trade-off (mitigated by a short default `flushIntervalMs` and the manually callable
 * `flush()`, useful in a graceful-shutdown hook), consistent with `@zanix/logger`'s own
 * fire-and-forget `SaveDataFunction` contract: a log call resolves once buffered, not once sent.
 */
export class BulkBuffer<T> {
  #items: T[] = []
  #maxSize: number
  #flushIntervalMs: number
  #timer: ReturnType<typeof setTimeout> | null = null
  #onFlush: (items: T[]) => Promise<unknown>

  /**
   * @param onFlush - Called with the current batch once a threshold is reached. Its promise is
   * awaited by `flush()`, but never by `push()` — pushing only buffers, it never waits on I/O.
   * @param options.maxSize - Max buffered items before an immediate flush. Defaults to `100`.
   * @param options.flushIntervalMs - Max milliseconds an item waits before a flush. Defaults to `5000`.
   */
  constructor(
    onFlush: (items: T[]) => Promise<unknown>,
    { maxSize = 100, flushIntervalMs = 5000 }: {
      maxSize?: number
      flushIntervalMs?: number
    } = {},
  ) {
    this.#onFlush = onFlush
    this.#maxSize = maxSize
    this.#flushIntervalMs = flushIntervalMs
  }

  /** Buffers an item, triggering an immediate flush once `maxSize` is reached. */
  public push(item: T): void {
    this.#items.push(item)

    if (this.#items.length >= this.#maxSize) {
      void this.flush()
      return
    }

    if (!this.#timer) {
      this.#timer = setTimeout(() => void this.flush(), this.#flushIntervalMs)
    }
  }

  /**
   * Flushes the current batch, if any. Safe to call concurrently or redundantly: the batch is
   * swapped out for a fresh array synchronously, before `onFlush` is ever awaited, so a call that
   * finds nothing pending (already claimed by another in-flight flush, or genuinely empty) is a
   * cheap no-op rather than double-sending the same batch.
   */
  public async flush(): Promise<void> {
    if (this.#items.length === 0) return

    const batch = this.#items
    this.#items = []

    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }

    await this.#onFlush(batch)
  }
}
