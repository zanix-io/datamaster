// deno-lint-ignore-file ban-types

/**
 * Represents a string that may have been protected through hashing.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with a **hashing** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with an optional `verify` method.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `HashedString` when the field contains multiple values.
 *
 * @example
 * ```ts
 * const password: HashedString = user.password;
 * if (password?.verify) {
 *   const isValid = await password.verify('inputPassword');
 *   console.log(isValid ? 'Password is valid' : 'Invalid password');
 * }
 * ```
 */
export type HashedString =
  | String & {
    /**
     * Verifies whether a given string matches the current hashed value.
     *
     * @param hash - The string to compare against the stored hash.
     * @returns A promise that resolves to `true` if the hash matches, or `false` otherwise.
     */
    verify?: (hash: string) => Promise<boolean>
  }
  | HashedString[]
  | undefined

/**
 * Represents a string that may have been protected through encryption.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with an **encryption** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with an optional `decrypt` method.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `EncryptedString` when the field contains multiple values.
 *
 * @example
 * ```ts
 * const secretData: EncryptedString = user.secretField;
 * if (secretData?.decrypt) {
 *   const plainText = await secretData.decrypt();
 *   console.log('Decrypted data:', plainText);
 * }
 * ```
 */
export type EncryptedString =
  | String & {
    /**
     * Decrypts the current string and returns its plain text value.
     *
     * @returns A promise that resolves to the decrypted string value.
     */
    decrypt?: () => Promise<string>
  }
  | string[]
    & {
      /**
       * Decrypts the current string and returns its plain text value.
       *
       * @returns A promise that resolves to the decrypted string value.
       */
      decrypt?: () => Promise<string[]>
    }
  | undefined

/**
 * Represents a string that may have been protected through masking.
 *
 * This type is returned by `dataProtectionGetter` when a field is
 * configured with a **masking** data protection policy.
 *
 * - If the field is protected, the value will be a `String` with optional methods
 *   to reveal the original data.
 * - If the field is not protected, it may simply be a `String` or `undefined`.
 * - It can also be an array of `MaskedString` when the field contains multiple values.
 *
 * @example
 * ```ts
 * const email: MaskedString = user.email;
 * console.log(email?.toString()); // "jxxx@example.com"
 *
 * if (email?.unmask) {
 *   const fullEmail = await email.unmask();
 *   console.log(fullEmail); // "john.doe@example.com"
 * }
 * ```
 */

export type MaskedString =
  | String & {
    /**
     * Reveals the original unmasked value, if available.
     *
     * @returns The full unmasked string.
     */
    unmask?: () => string
  }
  | string[] & {
    /**
     * Reveals the original unmasked value, if available.
     *
     * @returns The full unmasked string.
     */
    unmask?: () => string[]
  }
  | undefined
