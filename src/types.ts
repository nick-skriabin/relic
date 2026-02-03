/**
 * Encrypted value prefix
 * Format: relic:v1:base64(salt + iv + ciphertext)
 */
export const ENCRYPTED_VALUE_PREFIX = "relic:v1:";

/**
 * Secrets data type - flat or nested key/value mapping
 */
export type SecretsData = Record<string, unknown>;

/**
 * Options for createRelic
 */
export interface RelicOptions {
  /** The encrypted artifact string. If not provided, reads from artifactEnv */
  artifact?: string;
  /** Environment variable name for artifact. Default: "RELIC_ARTIFACT" */
  artifactEnv?: string;
  /** Environment variable name for master key. Default: "RELIC_MASTER_KEY" */
  masterKeyEnv?: string;
  /** Master key string. If not provided, reads from masterKeyEnv */
  masterKey?: string;
  /** Whether to cache decrypted secrets. Default: true */
  cache?: boolean;
}

/**
 * Relic instance interface
 */
export interface RelicInstance {
  /** Load and decrypt secrets, returns cached result if available */
  load(): Promise<SecretsData>;
  /** Get a specific secret by key, throws if not found */
  get(key: string): Promise<unknown>;
  /** Check if a key exists */
  has(key: string): Promise<boolean>;
  /** Get all keys */
  keys(): Promise<string[]>;
}

/**
 * Options for encryption (internal)
 */
export interface EncryptOptions {
  /** PBKDF2 iterations. Default: 150000 */
  iterations?: number;
}

/**
 * Default configuration values
 */
export const Defaults = {
  ARTIFACT_ENV: "RELIC_ARTIFACT",
  MASTER_KEY_ENV: "RELIC_MASTER_KEY",
  ARTIFACT_FILE: "config/relic.enc",
  KEY_FILE: "config/relic.key",
  KDF_ITERATIONS: 600_000,
  SALT_BYTES: 16,
  IV_BYTES: 12,
} as const;
