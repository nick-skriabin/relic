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
 * Global cache for decrypted secrets, keyed by artifact content.
 * This ensures decryption only happens once per unique artifact,
 * even across multiple createRelic() calls.
 */
const globalCache = new Map<string, SecretsData>();

/**
 * Cache for file contents to avoid repeated file reads
 */
const fileCache = new Map<string, string>();

/**
 * Read a file from the filesystem (Node.js only)
 * Throws a helpful error if running in Edge runtime
 */
function readArtifactFile(filePath: string): string {
  // Check file cache first
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)!;
  }

  try {
    // Dynamic require to avoid bundler issues in Edge
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    const content = fs.readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
    return content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Cannot read artifact file in Edge runtime. ` +
        `Use 'artifact' option with the file contents instead of 'artifactPath'.`
      );
    }
    throw err;
  }
}

/**
 * Create a Relic instance for accessing encrypted secrets
 *
 * @example
 * ```ts
 * // Using environment variables (default)
 * const relic = createRelic();
 * const secrets = await relic.load();
 *
 * // With file path (Node.js only)
 * const relic = createRelic({ artifactPath: "./config/relic.enc" });
 *
 * // With explicit artifact string (works everywhere)
 * const relic = createRelic({ artifact: myArtifactString });
 * ```
 */
export function createRelic(options?: RelicOptions): RelicInstance {
  const artifactEnv = options?.artifactEnv ?? Defaults.ARTIFACT_ENV;
  const masterKeyEnv = options?.masterKeyEnv ?? Defaults.MASTER_KEY_ENV;
  const shouldCache = options?.cache ?? true;

  /**
   * Resolve the artifact string
   */
  function getArtifact(): string {
    // 1. Direct artifact string
    if (options?.artifact) {
      return options.artifact;
    }

    // 2. File path (Node.js only)
    if (options?.artifactPath) {
      return readArtifactFile(options.artifactPath);
    }

    // 3. Environment variable
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
    const artifact = getArtifact();
    const masterKey = getMasterKey();

    // Cache key includes both artifact and master key
    // This ensures different keys don't return cached results from other keys
    const cacheKey = `${masterKey}:${artifact}`;

    // Check global cache first (singleton behavior)
    if (shouldCache && globalCache.has(cacheKey)) {
      return globalCache.get(cacheKey)!;
    }

    const secrets = await decryptAndParse(masterKey, artifact);

    if (shouldCache) {
      globalCache.set(cacheKey, secrets);
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
