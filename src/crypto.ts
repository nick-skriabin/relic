/**
 * Crypto utilities using Web Crypto API (Edge compatible)
 *
 * Encrypts individual values with format: relic:v1:base64(salt + iv + ciphertext)
 * This allows the JSON structure to remain visible for easier git diffs and merges.
 */

import { encodeBase64, decodeBase64 } from "./base64.ts";
import {
  decryptFailedError,
  invalidJsonError,
} from "./errors.ts";
import {
  Defaults,
  type EncryptOptions,
  type SecretsData,
  ENCRYPTED_VALUE_PREFIX,
} from "./types.ts";

/**
 * Get the Web Crypto API instance
 */
function getCrypto(): Crypto {
  // Web Crypto is available as globalThis.crypto in modern Node and Edge
  if (typeof globalThis.crypto !== "undefined") {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API not available");
}

/**
 * Generate random bytes
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

/**
 * Cache for derived keys to avoid expensive PBKDF2 re-computation
 * Key format: masterKey:base64(salt):iterations
 */
const keyCache = new Map<string, CryptoKey>();

/**
 * Derive an AES key from a master key using PBKDF2 (cached)
 */
async function deriveKey(
  masterKey: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  // Check cache first
  const cacheKey = `${masterKey}:${encodeBase64(salt)}:${iterations}`;
  const cached = keyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const crypto = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      // @ts-expect-error - Uint8Array is valid for salt in Web Crypto
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  // Cache for future use
  keyCache.set(cacheKey, key);
  return key;
}

/**
 * Check if a string is an encrypted value
 */
export function isEncryptedValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

/**
 * Encrypt a single value
 * Returns format: relic:v1:base64(iterations[4] + salt[16] + iv[12] + ciphertext)
 * Iterations are stored as 4-byte big-endian uint32
 */
export async function encryptValue(
  masterKey: string,
  value: unknown,
  options?: EncryptOptions
): Promise<string> {
  const crypto = getCrypto();
  const iterations = options?.iterations ?? Defaults.KDF_ITERATIONS;

  // Serialize value to JSON to preserve type
  const plaintext = JSON.stringify(value);

  // Generate salt and IV
  const salt = randomBytes(Defaults.SALT_BYTES);
  const iv = randomBytes(Defaults.IV_BYTES);

  // Derive key
  const key = await deriveKey(masterKey, salt, iterations);

  // Encrypt
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      // @ts-expect-error - Uint8Array is valid for iv in Web Crypto
      iv,
    },
    key,
    plaintextBytes
  );

  // Store iterations as 4-byte big-endian
  const iterBytes = new Uint8Array(4);
  new DataView(iterBytes.buffer).setUint32(0, iterations, false);

  // Concatenate iterations + salt + iv + ciphertext
  const ciphertext = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(4 + salt.length + iv.length + ciphertext.length);
  combined.set(iterBytes, 0);
  combined.set(salt, 4);
  combined.set(iv, 4 + salt.length);
  combined.set(ciphertext, 4 + salt.length + iv.length);

  return ENCRYPTED_VALUE_PREFIX + encodeBase64(combined);
}

/**
 * Decrypt a single encrypted value
 */
export async function decryptValue(
  masterKey: string,
  encryptedString: string
): Promise<unknown> {
  if (!isEncryptedValue(encryptedString)) {
    throw new Error("Not an encrypted value");
  }

  const crypto = getCrypto();

  // Remove prefix and decode
  const encoded = encryptedString.slice(ENCRYPTED_VALUE_PREFIX.length);
  const combined = decodeBase64(encoded);

  // Extract iterations (4 bytes), salt, iv, ciphertext
  const iterations = new DataView(combined.buffer, combined.byteOffset, 4).getUint32(0, false);
  const salt = combined.slice(4, 4 + Defaults.SALT_BYTES);
  const iv = combined.slice(4 + Defaults.SALT_BYTES, 4 + Defaults.SALT_BYTES + Defaults.IV_BYTES);
  const ciphertext = combined.slice(4 + Defaults.SALT_BYTES + Defaults.IV_BYTES);

  // Derive key
  const key = await deriveKey(masterKey, salt, iterations);

  // Decrypt
  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(plaintextBuffer);
    return JSON.parse(plaintext);
  } catch {
    throw decryptFailedError();
  }
}

/**
 * Recursively encrypt all values in an object (parallelized)
 */
export async function encryptSecrets(
  masterKey: string,
  data: SecretsData,
  options?: EncryptOptions
): Promise<SecretsData> {
  const entries = Object.entries(data);

  // Process all entries in parallel
  const encryptedEntries = await Promise.all(
    entries.map(async ([key, value]): Promise<[string, unknown]> => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        // Recursively encrypt nested objects
        return [key, await encryptSecrets(masterKey, value as SecretsData, options)];
      } else {
        // Encrypt leaf values (including arrays, strings, numbers, booleans, null)
        return [key, await encryptValue(masterKey, value, options)];
      }
    })
  );

  return Object.fromEntries(encryptedEntries);
}

/**
 * Recursively decrypt all encrypted values in an object (parallelized)
 */
export async function decryptSecrets(
  masterKey: string,
  data: SecretsData
): Promise<SecretsData> {
  const entries = Object.entries(data);

  // Process all entries in parallel
  const decryptedEntries = await Promise.all(
    entries.map(async ([key, value]): Promise<[string, unknown]> => {
      if (isEncryptedValue(value)) {
        // Decrypt encrypted values
        return [key, await decryptValue(masterKey, value as string)];
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        // Recursively decrypt nested objects
        return [key, await decryptSecrets(masterKey, value as SecretsData)];
      } else {
        // Keep non-encrypted values as-is
        return [key, value];
      }
    })
  );

  return Object.fromEntries(decryptedEntries);
}

/**
 * Encrypt secrets and serialize to JSON string (for saving artifact file)
 */
export async function encryptPayload(
  masterKey: string,
  plaintext: string,
  options?: EncryptOptions
): Promise<string> {
  const data = JSON.parse(plaintext) as SecretsData;
  const encrypted = await encryptSecrets(masterKey, data, options);
  return JSON.stringify(encrypted, null, 2) + "\n";
}

/**
 * Parse artifact and decrypt all values (for loading artifact file)
 */
export async function decryptPayload(
  masterKey: string,
  artifactString: string
): Promise<string> {
  let data: SecretsData;
  try {
    data = JSON.parse(artifactString) as SecretsData;
  } catch {
    throw invalidJsonError();
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw invalidJsonError();
  }

  const decrypted = await decryptSecrets(masterKey, data);
  return JSON.stringify(decrypted, null, 2) + "\n";
}

/**
 * Decrypt and parse artifact as JSON
 */
export async function decryptAndParse(
  masterKey: string,
  artifactString: string
): Promise<SecretsData> {
  let data: SecretsData;
  try {
    data = JSON.parse(artifactString) as SecretsData;
  } catch {
    throw invalidJsonError();
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw invalidJsonError();
  }

  return decryptSecrets(masterKey, data);
}
