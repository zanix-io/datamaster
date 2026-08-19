import { uint8ArrayToHEX } from '@zanix/helpers'

/**
 * Shared byte helpers used by every `ObjectStorage` implementation in this module —
 * `SeaweedFSObjectStorage` (`connector.ts`) and `LocalFilesystemObjectStorage`
 * (`local-filesystem-object-storage.ts`) both need the exact same "compute this package's own
 * checksum" and "read a `Uint8Array | ReadableStream<Uint8Array>` fully into memory" steps —
 * factored out here once rather than duplicated per implementation.
 *
 * @module
 */

/** This package's own sha256-hex identity for stored bytes — computed over the plaintext, before
 * any encryption is applied. */
export async function checksumOf(bytes: Uint8Array): Promise<string> {
  // Re-wrapped into a fresh, concretely `ArrayBuffer`-backed view — `bytes` may arrive typed as
  // `Uint8Array<ArrayBufferLike>`, which `SubtleCrypto.digest` doesn't structurally accept even
  // though it's a real `Uint8Array` at runtime.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return uint8ArrayToHEX(new Uint8Array(digest))
}

/** Reads a `Uint8Array | ReadableStream<Uint8Array>` fully into memory — needed up front regardless,
 * for the checksum/(optional) encryption step. */
export async function readAllBytes(
  data: Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data
  const response = new Response(data)
  return new Uint8Array(await response.arrayBuffer())
}
