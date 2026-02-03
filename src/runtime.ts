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

type FsModule = typeof import("fs");

/**
 * Cached fs module - lazy initialized
 */
let cachedFs: FsModule | null | undefined;
let fsInitPromise: Promise<FsModule | null> | null = null;

/**
 * Try to get the fs module that works in the current environment
 */
async function getFsModule(): Promise<FsModule | null> {
  if (cachedFs !== undefined) {
    return cachedFs;
  }

  // Prevent multiple concurrent initializations
  if (fsInitPromise) {
    return fsInitPromise;
  }

  fsInitPromise = (async () => {
    // Bun runtime - use import.meta.require
    if (typeof Bun !== "undefined" && typeof import.meta.require === "function") {
      try {
        cachedFs = import.meta.require("fs") as FsModule;
        return cachedFs;
      } catch {
        // fs not available
      }
    }

    // Node.js CJS - try globalThis.require
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const globalRequire = new Function(
        "return typeof require !== 'undefined' ? require : null"
      )();
      if (globalRequire) {
        cachedFs = globalRequire("fs") as FsModule;
        return cachedFs;
      }
    } catch {
      // require not available
    }

    // Node.js ESM - use dynamic import
    // Use indirect import via Function to avoid static analysis by Edge bundlers
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const dynamicImport = new Function("m", "return import(m)") as (
        m: string
      ) => Promise<FsModule>;
      const fs = await dynamicImport("node:fs");
      cachedFs = fs;
      return cachedFs;
    } catch {
      // Not in Node.js or fs not available
    }

    cachedFs = null;
    return null;
  })();

  return fsInitPromise;
}

/**
 * Read a file from the filesystem (Node.js/Bun only)
 * Throws a helpful error if running in Edge runtime
 */
async function readArtifactFile(filePath: string): Promise<string> {
  // Check file cache first
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)!;
  }

  const fs = await getFsModule();
  if (!fs) {
    throw new Error(
      `Cannot read artifact file in Edge runtime. ` +
      `Use 'artifact' option with the file contents instead of 'artifactPath'.`
    );
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
    return content;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Cannot read artifact file in Edge runtime. ` +
        `Use 'artifact' option with the file contents instead of 'artifactPath'.`
      );
    }
    throw err;
  }
}

/**
 * Try to read artifact file, return null if not found or in Edge runtime
 */
async function tryReadArtifactFile(filePath: string): Promise<string | null> {
  // Check file cache first
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)!;
  }

  const fs = await getFsModule();
  if (!fs) {
    // Edge runtime - can't read files
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
    return content;
  } catch {
    // File doesn't exist or can't be read
    return null;
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
  async function getArtifact(): Promise<string> {
    // 1. Direct artifact string
    if (options?.artifact) {
      return options.artifact;
    }

    // 2. Explicit file path (Node.js only)
    if (options?.artifactPath) {
      return await readArtifactFile(options.artifactPath);
    }

    // 3. Default file path (Node.js only) - try without erroring
    const defaultArtifact = await tryReadArtifactFile(Defaults.ARTIFACT_FILE);
    if (defaultArtifact) {
      return defaultArtifact;
    }

    // 4. Environment variable
    const envValue = getEnv(artifactEnv);
    if (envValue) {
      return envValue;
    }

    throw missingArtifactError();
  }

  /**
   * Resolve the master key
   */
  async function getMasterKey(): Promise<string> {
    // 1. Explicit master key option
    if (options?.masterKey) {
      return options.masterKey;
    }

    // 2. Default key file (config/relic.key)
    const keyFromFile = await tryReadArtifactFile(Defaults.KEY_FILE);
    if (keyFromFile) {
      return keyFromFile.trim();
    }

    // 3. Environment variable
    const envValue = getEnv(masterKeyEnv);
    if (envValue) {
      return envValue;
    }

    throw missingMasterKeyError();
  }

  /**
   * Load and decrypt secrets
   */
  async function load(): Promise<SecretsData> {
    const artifact = await getArtifact();
    const masterKey = await getMasterKey();

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
