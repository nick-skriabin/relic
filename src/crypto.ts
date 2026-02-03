/**
 * Crypto utilities using Web Crypto API (Edge compatible)
 */

import { encodeBase64, decodeBase64 } from "./base64.ts";
import {
  decryptFailedError,
  invalidArtifactFormatError,
  invalidJsonError,
  unsupportedVersionError,
} from "./errors.ts";
import {
  type ArtifactEnvelope,
  CURRENT_VERSION,
  Defaults,
  type EncryptOptions,
  type SecretsData,
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
 * Derive an AES key from a master key using PBKDF2
 */
async function deriveKey(
  masterKey: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
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
}

/**
 * Encrypt a plaintext string with the master key
 */
export async function encryptPayload(
  masterKey: string,
  plaintext: string,
  options?: EncryptOptions
): Promise<string> {
  const crypto = getCrypto();
  const iterations = options?.iterations ?? Defaults.KDF_ITERATIONS;

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

  // Build envelope
  const envelope: ArtifactEnvelope = {
    v: CURRENT_VERSION,
    kdf: {
      name: "pbkdf2",
      salt: encodeBase64(salt),
      iterations,
      hash: "sha-256",
    },
    cipher: {
      name: "aes-256-gcm",
      iv: encodeBase64(iv),
    },
    ciphertext: encodeBase64(new Uint8Array(ciphertextBuffer)),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt an artifact string with the master key
 */
export async function decryptPayload(
  masterKey: string,
  artifactString: string
): Promise<string> {
  const crypto = getCrypto();

  // Parse envelope
  let envelope: ArtifactEnvelope;
  try {
    envelope = JSON.parse(artifactString) as ArtifactEnvelope;
  } catch {
    throw invalidArtifactFormatError();
  }

  // Validate structure
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    typeof envelope.v !== "number" ||
    !envelope.kdf ||
    !envelope.cipher ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw invalidArtifactFormatError();
  }

  // Check version
  if (envelope.v !== CURRENT_VERSION) {
    throw unsupportedVersionError(envelope.v);
  }

  // Decode parameters
  const salt = decodeBase64(envelope.kdf.salt);
  const iv = decodeBase64(envelope.cipher.iv);
  const ciphertext = decodeBase64(envelope.ciphertext);

  // Derive key
  const key = await deriveKey(masterKey, salt, envelope.kdf.iterations);

  // Decrypt
  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        // @ts-expect-error - Uint8Array is valid for iv in Web Crypto
        iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintextBuffer);
  } catch {
    throw decryptFailedError();
  }
}

/**
 * Decrypt and parse artifact as JSON
 */
export async function decryptAndParse(
  masterKey: string,
  artifactString: string
): Promise<SecretsData> {
  const plaintext = await decryptPayload(masterKey, artifactString);

  try {
    const data = JSON.parse(plaintext);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw invalidJsonError();
    }
    return data as SecretsData;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw invalidJsonError();
    }
    throw e;
  }
}
