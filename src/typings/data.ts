// deno-lint-ignore-file ban-types

/**
 * A single hashed string value with its `verify` method attached — the scalar half of
 * {@link VerifiableObject}. Prefer this directly (instead of the full union) when you know the
 * underlying field is not array-valued (e.g. `password: { type: String, ... }`) — it lets you call
 * `.verify()` without first narrowing away the `VerifiableObject[]` branch, which doesn't carry the
 * method itself (see {@link VerifiableArray}).
 */
export type VerifiableScalar = String & {
  /**
   * Verifies whether a given string matches the current hashed value.
   *
   * @param hash - The string to compare against the stored hash.
   * @returns A promise that resolves to `true` if the hash matches, or `false` otherwise.
   */
  verify?: (hash: string) => Promise<boolean>
}

/**
 * An array of {@link VerifiableScalar} — the array half of {@link VerifiableObject}. Unlike
 * {@link UnmaskableArray}/{@link DecryptableArray}, `verify` is **not** attached to the array
 * itself; each element carries its own (hashing is one-way, so there's no single array-level
 * operation to attach — every element was hashed independently). Prefer this directly (instead of
 * the full union) when you know the underlying field is array-valued (e.g. `phones: [String]`).
 */
export type VerifiableArray = VerifiableScalar[]

/**
 * Same as {@link VerifiableScalar}, with `verify` guaranteed present instead of optional — for
 * casting a value you already know came back protected (e.g. read off a hydrated document you
 * control the schema of), so call sites don't need a `!`/`?.` on `verify` itself.
 *
 * Not used internally by this package: the library's own generic code paths construct/pass these
 * values loosely (a value may or may not end up wrapped, depending on whether protection is even
 * configured for that path), which needs `verify` optional to type-check. This is purely a
 * consumer-side convenience — equivalent to writing `Required<VerifiableScalar>` yourself.
 *
 * @example
 * ```ts
 * const password = user.password as RequiredVerifiableScalar
 * await password.verify('inputPassword') // no `!` needed
 * ```
 */
export type RequiredVerifiableScalar = Required<VerifiableScalar>

/** Same as {@link VerifiableArray}, with each element's `verify` guaranteed present — see
 * {@link RequiredVerifiableScalar}. */
export type RequiredVerifiableArray = RequiredVerifiableScalar[]

/**
 * Represents a string that may have been protected through hashing.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with a **hashing** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with an optional `verify` method.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `VerifiableObject` when the field contains multiple values.
 *
 * This is a union of both the scalar and array shapes ({@link VerifiableScalar} |
 * {@link VerifiableArray}) — reach for one of those directly instead when you know which shape a
 * given field actually has, to avoid narrowing away the other branch before `.verify()` becomes
 * callable.
 *
 * @example
 * ```ts
 * const password: VerifiableObject = user.password;
 * if (password?.verify) {
 *   const isValid = await password.verify('inputPassword');
 *   console.log(isValid ? 'Password is valid' : 'Invalid password');
 * }
 * ```
 */
export type VerifiableObject =
  | VerifiableScalar
  | VerifiableArray
  | null
  | undefined

/**
 * A single encrypted string value with its `decrypt` method attached — the scalar half of
 * {@link DecryptableObject}. Prefer this directly (instead of the full union) when you know the
 * underlying field is not array-valued.
 */
export type DecryptableScalar = String & {
  /**
   * Decrypts the current string and returns its plain text value.
   *
   * @returns A promise that resolves to the decrypted string value.
   */
  decrypt?: () => Promise<string>
}

/**
 * An array of decrypted strings with a single `decrypt` method attached to the array itself — the
 * array half of {@link DecryptableObject}. Prefer this directly (instead of the full union) when
 * you know the underlying field is array-valued.
 */
export type DecryptableArray = string[] & {
  /**
   * Decrypts the current string and returns its plain text value.
   *
   * @returns A promise that resolves to the decrypted string value.
   */
  decrypt?: () => Promise<string[]>
}

/** Same as {@link DecryptableScalar}, with `decrypt` guaranteed present — see
 * {@link RequiredVerifiableScalar} for the rationale (this is the `mask`/`encrypt` equivalent). */
export type RequiredDecryptableScalar = Required<DecryptableScalar>

/** Same as {@link DecryptableArray}, with `decrypt` guaranteed present — see
 * {@link RequiredDecryptableScalar}. */
export type RequiredDecryptableArray = Required<DecryptableArray>

/**
 * Represents a string that may have been protected through encryption.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with an **encryption** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with an optional `decrypt` method.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `DecryptableObject` when the field contains multiple values.
 *
 * This is a union of both the scalar and array shapes ({@link DecryptableScalar} |
 * {@link DecryptableArray}) — reach for one of those directly instead when you know which shape a
 * given field actually has, to avoid narrowing away the other branch before `.decrypt()` becomes
 * callable.
 *
 * @example
 * ```ts
 * const secretData: DecryptableObject = user.secretField;
 * if (secretData?.decrypt) {
 *   const plainText = await secretData.decrypt();
 *   console.log('Decrypted data:', plainText);
 * }
 * ```
 */
export type DecryptableObject =
  | DecryptableScalar
  | DecryptableArray
  | null
  | undefined

/**
 * A single masked string value with its `unmask` method attached — the scalar half of
 * {@link UnmaskableObject}. Prefer this directly (instead of the full union) when you know the
 * underlying field is not array-valued.
 */
export type UnmaskableScalar = String & {
  /**
   * Reveals the original unmasked value, if available.
   *
   * @returns The full unmasked string.
   */
  unmask?: () => string
}

/**
 * An array of masked strings with a single `unmask` method attached to the array itself — the
 * array half of {@link UnmaskableObject}. Prefer this directly (instead of the full union) when
 * you know the underlying field is array-valued.
 */
export type UnmaskableArray = string[] & {
  /**
   * Reveals the original unmasked value, if available.
   *
   * @returns The full unmasked string.
   */
  unmask?: () => string[]
}

/** Same as {@link UnmaskableScalar}, with `unmask` guaranteed present — see
 * {@link RequiredVerifiableScalar} for the rationale. */
export type RequiredUnmaskableScalar = Required<UnmaskableScalar>

/** Same as {@link UnmaskableArray}, with `unmask` guaranteed present — see
 * {@link RequiredUnmaskableScalar}. */
export type RequiredUnmaskableArray = Required<UnmaskableArray>

/**
 * Represents a string that may have been protected through masking.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with a **masking** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with optional methods
 *   to reveal the original data.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `UnmaskableObject` when the field contains multiple values.
 *
 * This is a union of both the scalar and array shapes ({@link UnmaskableScalar} |
 * {@link UnmaskableArray}) — reach for one of those directly instead when you know which shape a
 * given field actually has, to avoid narrowing away the other branch before `.unmask()` becomes
 * callable.
 *
 * @example
 * ```ts
 * const email: UnmaskableObject = user.email;
 * console.log(email?.toString()); // "jxxx@example.com"
 *
 * if (email?.unmask) {
 *   const fullEmail = await email.unmask();
 *   console.log(fullEmail); // "john.doe@example.com"
 * }
 * ```
 */
export type UnmaskableObject =
  | UnmaskableScalar
  | UnmaskableArray
  | null
  | undefined
