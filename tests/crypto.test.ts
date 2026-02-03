import { test, expect, describe } from "bun:test";
import {
  encryptPayload,
  decryptPayload,
  decryptAndParse,
  encryptValue,
  decryptValue,
  encryptSecrets,
  decryptSecrets,
  isEncryptedValue,
  RelicError,
  ErrorCodes,
  ENCRYPTED_VALUE_PREFIX,
} from "../src/index.ts";

// Use low iterations for faster tests
const TEST_ITERATIONS = 1000;

describe("crypto", () => {
  describe("single value encryption", () => {
    test("encrypts and decrypts a string", async () => {
      const masterKey = "test-key";
      const value = "secret123";

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      expect(encrypted.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);

      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toBe(value);
    });

    test("encrypts and decrypts a number", async () => {
      const masterKey = "test-key";
      const value = 42;

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toBe(value);
    });

    test("encrypts and decrypts a boolean", async () => {
      const masterKey = "test-key";
      const value = true;

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toBe(value);
    });

    test("encrypts and decrypts null", async () => {
      const masterKey = "test-key";
      const value = null;

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toBe(value);
    });

    test("encrypts and decrypts an array", async () => {
      const masterKey = "test-key";
      const value = [1, 2, "three"];

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toEqual(value);
    });

    test("encrypts and decrypts unicode", async () => {
      const masterKey = "test-key";
      const value = "🔐中文العربية";

      const encrypted = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const decrypted = await decryptValue(masterKey, encrypted);
      expect(decrypted).toBe(value);
    });

    test("produces different ciphertext for same value (unique salt/iv)", async () => {
      const masterKey = "test-key";
      const value = "secret";

      const encrypted1 = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });
      const encrypted2 = await encryptValue(masterKey, value, { iterations: TEST_ITERATIONS });

      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt to the same value
      expect(await decryptValue(masterKey, encrypted1)).toBe(value);
      expect(await decryptValue(masterKey, encrypted2)).toBe(value);
    });
  });

  describe("isEncryptedValue", () => {
    test("returns true for encrypted values", async () => {
      const encrypted = await encryptValue("key", "value", { iterations: TEST_ITERATIONS });
      expect(isEncryptedValue(encrypted)).toBe(true);
    });

    test("returns false for plain strings", () => {
      expect(isEncryptedValue("plain string")).toBe(false);
      expect(isEncryptedValue("")).toBe(false);
      expect(isEncryptedValue("relic:")).toBe(false);
    });

    test("returns false for non-strings", () => {
      expect(isEncryptedValue(42)).toBe(false);
      expect(isEncryptedValue(null)).toBe(false);
      expect(isEncryptedValue(undefined)).toBe(false);
      expect(isEncryptedValue({})).toBe(false);
    });
  });

  describe("secrets encryption", () => {
    test("encrypts all values in flat object", async () => {
      const masterKey = "test-key";
      const secrets = {
        API_KEY: "secret123",
        DEBUG: true,
        COUNT: 42,
      };

      const encrypted = await encryptSecrets(masterKey, secrets, { iterations: TEST_ITERATIONS });

      // All values should be encrypted
      expect(isEncryptedValue(encrypted.API_KEY)).toBe(true);
      expect(isEncryptedValue(encrypted.DEBUG)).toBe(true);
      expect(isEncryptedValue(encrypted.COUNT)).toBe(true);

      // Decrypt and verify
      const decrypted = await decryptSecrets(masterKey, encrypted);
      expect(decrypted).toEqual(secrets);
    });

    test("encrypts nested objects recursively", async () => {
      const masterKey = "test-key";
      const secrets = {
        database: {
          host: "localhost",
          password: "secret",
        },
        api: {
          key: "api-key-123",
        },
      };

      const encrypted = await encryptSecrets(masterKey, secrets, { iterations: TEST_ITERATIONS });

      // Nested structure should be preserved
      expect(typeof encrypted.database).toBe("object");
      expect(typeof encrypted.api).toBe("object");

      // Leaf values should be encrypted
      expect(isEncryptedValue((encrypted.database as Record<string, unknown>).host)).toBe(true);
      expect(isEncryptedValue((encrypted.database as Record<string, unknown>).password)).toBe(true);
      expect(isEncryptedValue((encrypted.api as Record<string, unknown>).key)).toBe(true);

      // Decrypt and verify
      const decrypted = await decryptSecrets(masterKey, encrypted);
      expect(decrypted).toEqual(secrets);
    });
  });

  describe("payload encryption (full roundtrip)", () => {
    test("encrypts and decrypts simple payload", async () => {
      const masterKey = "test-master-key-12345";
      const data = { API_KEY: "secret123" };

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(JSON.parse(decrypted)).toEqual(data);
    });

    test("encrypts and decrypts complex payload", async () => {
      const masterKey = "another-test-key";
      const data = {
        API_KEY: "secret123",
        DEBUG: true,
        COUNT: 42,
        NULLABLE: null,
        NESTED_STRING: "foo bar baz",
      };

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(JSON.parse(decrypted)).toEqual(data);
    });

    test("artifact is readable JSON with encrypted values", async () => {
      const masterKey = "test-key";
      const data = {
        API_KEY: "secret",
        DEBUG: true,
      };

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });

      // Should be valid JSON
      const parsed = JSON.parse(encrypted);

      // Keys should be visible
      expect(Object.keys(parsed)).toContain("API_KEY");
      expect(Object.keys(parsed)).toContain("DEBUG");

      // Values should be encrypted strings
      expect(typeof parsed.API_KEY).toBe("string");
      expect(parsed.API_KEY.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
    });

    test("handles unicode content", async () => {
      const masterKey = "unicode-key";
      const data = { emoji: "🔐", chinese: "中文", arabic: "العربية" };

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(JSON.parse(decrypted)).toEqual(data);
    });

    test("handles empty object", async () => {
      const masterKey = "empty-key";
      const data = {};

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(JSON.parse(decrypted)).toEqual(data);
    });
  });

  describe("wrong key detection", () => {
    test("fails with wrong key on single value", async () => {
      const encrypted = await encryptValue("correct-key", "secret", {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptValue("wrong-key", encrypted)).rejects.toThrow(RelicError);

      try {
        await decryptValue("wrong-key", encrypted);
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.DECRYPT_FAILED);
      }
    });

    test("fails with wrong key on secrets", async () => {
      const encrypted = await encryptSecrets("correct-key", { secret: "value" }, {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptSecrets("wrong-key", encrypted)).rejects.toThrow(RelicError);
    });
  });

  describe("tamper detection", () => {
    test("fails if encrypted value is modified", async () => {
      const masterKey = "tamper-key";
      const encrypted = await encryptValue(masterKey, "secret", {
        iterations: TEST_ITERATIONS,
      });

      // Modify a character in the middle
      const midpoint = Math.floor(encrypted.length / 2);
      const tampered =
        encrypted.slice(0, midpoint) +
        (encrypted[midpoint] === "A" ? "B" : "A") +
        encrypted.slice(midpoint + 1);

      await expect(decryptValue(masterKey, tampered)).rejects.toThrow(RelicError);
    });
  });

  describe("invalid input handling", () => {
    test("fails on invalid JSON artifact", async () => {
      const masterKey = "format-key";

      await expect(
        decryptPayload(masterKey, "not valid json")
      ).rejects.toThrow(RelicError);

      try {
        await decryptPayload(masterKey, "not valid json");
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.INVALID_JSON);
      }
    });

    test("fails if artifact is not an object", async () => {
      const masterKey = "format-key";

      await expect(
        decryptPayload(masterKey, '"just a string"')
      ).rejects.toThrow(RelicError);

      await expect(
        decryptPayload(masterKey, "[1, 2, 3]")
      ).rejects.toThrow(RelicError);
    });
  });

  describe("decryptAndParse", () => {
    test("decrypts and parses valid JSON object", async () => {
      const masterKey = "parse-key";
      const data = { API_KEY: "secret", DEBUG: true, COUNT: 42 };

      const encrypted = await encryptPayload(masterKey, JSON.stringify(data), {
        iterations: TEST_ITERATIONS,
      });
      const result = await decryptAndParse(masterKey, encrypted);

      expect(result).toEqual(data);
    });

    test("fails if artifact is an array", async () => {
      const masterKey = "array-key";

      await expect(
        decryptAndParse(masterKey, '["not", "an", "object"]')
      ).rejects.toThrow(RelicError);

      try {
        await decryptAndParse(masterKey, '["not", "an", "object"]');
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.INVALID_JSON);
      }
    });

    test("fails if artifact is a primitive", async () => {
      const masterKey = "primitive-key";

      await expect(
        decryptAndParse(masterKey, '"just a string"')
      ).rejects.toThrow(RelicError);
    });
  });
});
