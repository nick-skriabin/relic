/**
 * Runtime API for Relic - works in Node and Edge environments
 */

import { decryptAndParse } from "./crypto.ts";
import { getEnv } from "./env.ts";
import {
  keyNotFoundError,
  missingArtifactError,
  missingMasterKeyError,
} from "./errors.ts";
import {
  Defaults,
  type RelicInstance,
  type RelicOptions,
  type SecretsData,
} from "./types.ts";

/**
 * Create a Relic instance for accessing encrypted secrets
 *
 * @example
 * ```ts
 * // Using environment variables (default)
 * const relic = createRelic();
 * const secrets = await relic.load();
 *
 * // With explicit artifact
 * const relic = createRelic({ artifact: myArtifactString });
 * const apiKey = await relic.get("API_KEY");
 * ```
 */
export function createRelic(options?: RelicOptions): RelicInstance {
  const artifactEnv = options?.artifactEnv ?? Defaults.ARTIFACT_ENV;
  const masterKeyEnv = options?.masterKeyEnv ?? Defaults.MASTER_KEY_ENV;
  const shouldCache = options?.cache ?? true;

  let cachedSecrets: SecretsData | null = null;

  /**
   * Resolve the artifact string
   */
  function getArtifact(): string {
    if (options?.artifact) {
      return options.artifact;
    }
    const envValue = getEnv(artifactEnv);
    if (!envValue) {
      throw missingArtifactError();
    }
    return envValue;
  }

  /**
   * Resolve the master key
   */
  function getMasterKey(): string {
    if (options?.masterKey) {
      return options.masterKey;
    }
    const envValue = getEnv(masterKeyEnv);
    if (!envValue) {
      throw missingMasterKeyError();
    }
    return envValue;
  }

  /**
   * Load and decrypt secrets
   */
  async function load(): Promise<SecretsData> {
    if (shouldCache && cachedSecrets !== null) {
      return cachedSecrets;
    }

    const artifact = getArtifact();
    const masterKey = getMasterKey();
    const secrets = await decryptAndParse(masterKey, artifact);

    if (shouldCache) {
      cachedSecrets = secrets;
    }

    return secrets;
  }

  /**
   * Get a specific secret by key
   */
  async function get(key: string): Promise<unknown> {
    const secrets = await load();
    if (!(key in secrets)) {
      throw keyNotFoundError(key);
    }
    return secrets[key];
  }

  /**
   * Check if a key exists
   */
  async function has(key: string): Promise<boolean> {
    const secrets = await load();
    return key in secrets;
  }

  /**
   * Get all keys
   */
  async function keys(): Promise<string[]> {
    const secrets = await load();
    return Object.keys(secrets);
  }

  return {
    load,
    get,
    has,
    keys,
  };
}
