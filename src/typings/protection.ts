import type { MaskingBaseOptions } from '@zanix/types'

/** Data policy version type */
export type DataPolicyVersion = `v${number}` | 'v0' // first default version

/**
 * Defines the security level of the hash:
 * - 'low': Minimal security
 * - 'medium': Standard security
 * - 'medium-high': Enhanced security
 * - 'high': Maximum security
 */
export type HashingLevels = 'low' | 'medium' | 'medium-high' | 'high'

/**
 * Masking data protection settings.
 *
 * Inherits from MaskingBaseOptions and defines how sensitive data should be masked.
 */
export type MaskingSettings = MaskingBaseOptions

/**
 * Encryption data protection settings.
 *
 * Defines the encryption strategy type. Can be:
 * - 'asymmetric': Uses a public/private key pair
 * - 'symmetric': Uses a single secret key
 */
export type EncryptSettings = { type?: 'asymmetric' | 'symmetric' }

/**
 * Hashing data protection settings.
 *
 * Defines the security level of the hash:
 * - 'low': Minimal security
 * - 'medium': Standard security
 * - 'medium-high': Enhanced security
 * - 'high': Maximum security
 */
export type HashingSettings = { level?: HashingLevels; useSalt?: Uint8Array | number | false }

/**
 * Group of all available data protection settings by strategy.
 */
export type DataProtectionSettings = {
  mask: MaskingSettings
  hash: HashingSettings
  encrypt: EncryptSettings
}

/**
 * Available data protection strategies.
 */
export type DataProtectionMethods = keyof DataProtectionSettings

/**
 * Configuration for a single data protection strategy.
 *
 * @template S - The strategy key ('mask', 'hash', or 'encrypt')
 */
export type DataProtectionConfig<S extends DataProtectionMethods> = {
  /** The selected protection strategy */
  strategy: S
  /** Optional strategy-specific settings */
  settings?: DataProtectionSettings[S]
}

/**
 * Base configuration for a versioned data protection strategy.
 *
 * This type represents a data protection configuration that can have multiple versions,
 * allowing you to define different settings for each version while keeping track of
 * the currently active version.
 *
 * @template S - The strategy key ('mask', 'hash', or 'encrypt')
 *
 * @example
 * // Example of a masking configuration with two versions
 * const maskingConfig = {
 *   activeVersion: 'v2',
 *   versionConfigs: {
 *     v1: {
 *       strategy: 'mask',
 *       settings: { endBefore: 3 }
 *     },
 *     v2: {
 *       strategy: 'mask',
 *       settings: { endBefore: 1 }
 *     }
 *   }
 * }
 */
export type DataProtectionBase<S extends DataProtectionMethods> = {
  /** The currently active version identifier */
  activeVersion: DataPolicyVersion
  /** Map of version-specific configurations */
  versionConfigs: {
    [key in DataPolicyVersion]: DataProtectionConfig<S>
  }
}

/** Specific protection configurations */
export type HashingProtectionConfig = DataProtectionConfig<'hash'>
export type MaskingProtectionConfig = DataProtectionConfig<'mask'>
export type EncryptionProtectionConfig = DataProtectionConfig<'encrypt'>

/** Versioned hashing protection configuration */
export type HashingDataProtection = DataProtectionBase<'hash'>
/** Versioned masking protection configuration */
export type MaskingDataProtection = DataProtectionBase<'mask'>
/** Versioned encryption protection configuration */
export type EncryptionDataProtection = DataProtectionBase<'encrypt'>

/** Union of all single-strategy configurations */
export type DataProtectionConfigs =
  | HashingProtectionConfig
  | MaskingProtectionConfig
  | EncryptionProtectionConfig

/** Union of all versioned data protection types */
export type DataProtection =
  | HashingDataProtection
  | MaskingDataProtection
  | EncryptionDataProtection

/**
 * Type representing any valid data protection option.
 * Can be:
 * - The name of a strategy ('mask', 'hash', 'encrypt')
 * - A single-strategy configuration object
 * - A full versioned data protection object
 */
export type DataProtectionOptions =
  | DataProtectionMethods
  | DataProtectionConfigs
  | DataProtection

/** The field is visible to authenticated users, and may be partially masked for anonymous users */
export type ProtectedDataSettings = {
  /** Masking options */
  virtualMask?: MaskingBaseOptions
}

type PrivateDataSettings = never
type InternalDataSettings = never

/**
 * Group of all available data access settings by strategy.
 *
 * Possible values:
 *   `protected`: The field is visible to authenticated users, and may be partially masked for anonymous users.
 *   `private`: The field is not shown at all to anonymous users and is only visible to authenticated users.
 *   `internal`: The field is not exposed to users at all.
 */
export type AccessStrategiesSettings = {
  /** The field is visible to authenticated users, and may be partially masked for anonymous users */
  protected: ProtectedDataSettings
  /** The field is not shown at all to anonymous users and is only visible to authenticated users. */
  private: PrivateDataSettings
  /** The field is not exposed to users at all. */
  internal: InternalDataSettings
}

/**
 * Available data accesss strategies.
 */
export type AccessStrategies = keyof AccessStrategiesSettings

/**
 * Configuration for a single data access strategy.
 *
 * @template S - The strategy key ('private', 'protected', or 'internal')
 */
export type DataAccessBaseConfig<S extends AccessStrategies> = {
  /** The selected access strategy */
  strategy: S
  /** Optional strategy-specific settings */
  settings?: AccessStrategiesSettings[S]
}

/** Specific access configurations */
export type PrivateDataAccessConfig = DataAccessBaseConfig<'private'>
export type InternalDataAccessConfig = DataAccessBaseConfig<'internal'>
export type ProtectedDataAccessConfig = DataAccessBaseConfig<'protected'>

/** Union of all single-strategy configurations */
export type DataAccessConfig =
  | PrivateDataAccessConfig
  | ProtectedDataAccessConfig
  | InternalDataAccessConfig

/**
 * Defines access to a data field.
 *
 * If the strategy is 'protected', it may include options like virtual masking.
 * Possible values:
 *   `protected`: The field is visible to authenticated users, and may be partially masked for anonymous users.
 *   `private`: The field is not shown at all to anonymous users and is only visible to authenticated users.
 *   `internal`: The field is not exposed to users at all.
 */
export type DataFieldAccess = AccessStrategies | DataAccessConfig
