import { test, expect, describe } from "bun:test";
import {
  encryptPayload,
  decryptPayload,
  decryptAndParse,
  RelicError,
  ErrorCodes,
} from "../src/index.ts";

// Use low iterations for faster tests
const TEST_ITERATIONS = 1000;

describe("crypto", () => {
  describe("encrypt/decrypt roundtrip", () => {
    test("encrypts and decrypts simple payload", async () => {
      const masterKey = "test-master-key-12345";
      const plaintext = '{"API_KEY": "secret123"}';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("encrypts and decrypts complex payload", async () => {
      const masterKey = "another-test-key";
      const plaintext = JSON.stringify({
        API_KEY: "secret123",
        DEBUG: true,
        COUNT: 42,
        NULLABLE: null,
        NESTED_STRING: "foo bar baz",
      });

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("produces different ciphertext for same plaintext (unique salt/iv)", async () => {
      const masterKey = "test-key";
      const plaintext = '{"secret": "value"}';

      const encrypted1 = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const encrypted2 = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt to the same value
      const decrypted1 = await decryptPayload(masterKey, encrypted1);
      const decrypted2 = await decryptPayload(masterKey, encrypted2);
      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    test("handles unicode content", async () => {
      const masterKey = "unicode-key";
      const plaintext = '{"emoji": "🔐", "chinese": "中文", "arabic": "العربية"}';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("handles empty object", async () => {
      const masterKey = "empty-key";
      const plaintext = "{}";

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const decrypted = await decryptPayload(masterKey, encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("wrong key detection", () => {
    test("fails with wrong key", async () => {
      const correctKey = "correct-key";
      const wrongKey = "wrong-key";
      const plaintext = '{"secret": "value"}';

      const encrypted = await encryptPayload(correctKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptPayload(wrongKey, encrypted)).rejects.toThrow(
        RelicError
      );

      try {
        await decryptPayload(wrongKey, encrypted);
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.DECRYPT_FAILED);
      }
    });
  });

  describe("tamper detection", () => {
    test("fails if ciphertext is modified", async () => {
      const masterKey = "tamper-key";
      const plaintext = '{"secret": "value"}';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      // Parse, modify ciphertext, reserialize
      const envelope = JSON.parse(encrypted);
      const ciphertext = envelope.ciphertext;
      // Flip a character in the middle of the ciphertext
      const midpoint = Math.floor(ciphertext.length / 2);
      const modified =
        ciphertext.slice(0, midpoint) +
        (ciphertext[midpoint] === "A" ? "B" : "A") +
        ciphertext.slice(midpoint + 1);
      envelope.ciphertext = modified;
      const tampered = JSON.stringify(envelope);

      await expect(decryptPayload(masterKey, tampered)).rejects.toThrow(
        RelicError
      );
    });

    test("fails if IV is modified", async () => {
      const masterKey = "iv-tamper-key";
      const plaintext = '{"secret": "value"}';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      const envelope = JSON.parse(encrypted);
      envelope.cipher.iv = "AAAAAAAAAAAA"; // Modified IV
      const tampered = JSON.stringify(envelope);

      await expect(decryptPayload(masterKey, tampered)).rejects.toThrow(
        RelicError
      );
    });
  });

  describe("invalid artifact format", () => {
    test("fails on invalid JSON", async () => {
      const masterKey = "format-key";

      await expect(
        decryptPayload(masterKey, "not valid json")
      ).rejects.toThrow(RelicError);

      try {
        await decryptPayload(masterKey, "not valid json");
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(
          ErrorCodes.INVALID_ARTIFACT_FORMAT
        );
      }
    });

    test("fails on missing required fields", async () => {
      const masterKey = "missing-field-key";

      await expect(
        decryptPayload(masterKey, JSON.stringify({ v: 1 }))
      ).rejects.toThrow(RelicError);
    });

    test("fails on unsupported version", async () => {
      const masterKey = "version-key";
      const plaintext = '{"secret": "value"}';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      const envelope = JSON.parse(encrypted);
      envelope.v = 999;
      const modified = JSON.stringify(envelope);

      await expect(decryptPayload(masterKey, modified)).rejects.toThrow(
        RelicError
      );

      try {
        await decryptPayload(masterKey, modified);
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.UNSUPPORTED_VERSION);
      }
    });
  });

  describe("decryptAndParse", () => {
    test("decrypts and parses valid JSON object", async () => {
      const masterKey = "parse-key";
      const data = { API_KEY: "secret", DEBUG: true, COUNT: 42 };
      const plaintext = JSON.stringify(data);

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });
      const result = await decryptAndParse(masterKey, encrypted);

      expect(result).toEqual(data);
    });

    test("fails if decrypted content is not valid JSON", async () => {
      const masterKey = "invalid-json-key";
      const plaintext = "not json at all";

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptAndParse(masterKey, encrypted)).rejects.toThrow(
        RelicError
      );

      try {
        await decryptAndParse(masterKey, encrypted);
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.INVALID_JSON);
      }
    });

    test("fails if decrypted content is an array", async () => {
      const masterKey = "array-key";
      const plaintext = '["not", "an", "object"]';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptAndParse(masterKey, encrypted)).rejects.toThrow(
        RelicError
      );

      try {
        await decryptAndParse(masterKey, encrypted);
      } catch (err) {
        expect(err).toBeInstanceOf(RelicError);
        expect((err as RelicError).code).toBe(ErrorCodes.INVALID_JSON);
      }
    });

    test("fails if decrypted content is a primitive", async () => {
      const masterKey = "primitive-key";
      const plaintext = '"just a string"';

      const encrypted = await encryptPayload(masterKey, plaintext, {
        iterations: TEST_ITERATIONS,
      });

      await expect(decryptAndParse(masterKey, encrypted)).rejects.toThrow(
        RelicError
      );
    });
  });
});
