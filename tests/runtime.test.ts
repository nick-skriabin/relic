import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  createRelic,
  encryptPayload,
  RelicError,
  ErrorCodes,
} from "../src/index.ts";

// Use low iterations for faster tests
const TEST_ITERATIONS = 1000;

describe("runtime", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("createRelic with explicit artifact", () => {
    test("loads secrets from explicit artifact", async () => {
      const masterKey = "explicit-key";
      const secrets = { API_KEY: "secret123", DEBUG: true };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({
        artifact,
        masterKey,
      });

      const loaded = await relic.load();
      expect(loaded).toEqual(secrets);
    });

    test("get() returns specific secret", async () => {
      const masterKey = "get-key";
      const secrets = { API_KEY: "secret123", DB_URL: "postgres://..." };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey });

      expect(await relic.get("API_KEY")).toBe("secret123");
      expect(await relic.get("DB_URL")).toBe("postgres://...");
    });

    test("get() throws for missing key", async () => {
      const masterKey = "missing-key";
      const secrets = { API_KEY: "secret123" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey });

      await expect(relic.get("NONEXISTENT")).rejects.toThrow(RelicError);

      try {
        await relic.get("NONEXISTENT");
      } catch (err) {
        expect((err as RelicError).code).toBe(ErrorCodes.KEY_NOT_FOUND);
      }
    });

    test("has() returns true for existing key", async () => {
      const masterKey = "has-key";
      const secrets = { API_KEY: "secret123" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey });

      expect(await relic.has("API_KEY")).toBe(true);
      expect(await relic.has("NONEXISTENT")).toBe(false);
    });

    test("keys() returns all keys", async () => {
      const masterKey = "keys-key";
      const secrets = { API_KEY: "secret123", DB_URL: "url", DEBUG: true };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey });

      const keys = await relic.keys();
      expect(keys.sort()).toEqual(["API_KEY", "DB_URL", "DEBUG"]);
    });
  });

  describe("createRelic with environment variables", () => {
    test("loads artifact from env var", async () => {
      const masterKey = "env-key";
      const secrets = { FROM_ENV: "value" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      process.env.RELIC_ARTIFACT = artifact;
      process.env.RELIC_MASTER_KEY = masterKey;

      const relic = createRelic();
      const loaded = await relic.load();

      expect(loaded).toEqual(secrets);
    });

    test("supports custom env var names", async () => {
      const masterKey = "custom-env-key";
      const secrets = { CUSTOM: "value" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      process.env.MY_SECRETS = artifact;
      process.env.MY_KEY = masterKey;

      const relic = createRelic({
        artifactEnv: "MY_SECRETS",
        masterKeyEnv: "MY_KEY",
      });

      const loaded = await relic.load();
      expect(loaded).toEqual(secrets);
    });

    test("throws if artifact env var is missing", async () => {
      process.env.RELIC_MASTER_KEY = "some-key";
      delete process.env.RELIC_ARTIFACT;

      const relic = createRelic();

      await expect(relic.load()).rejects.toThrow(RelicError);

      try {
        await relic.load();
      } catch (err) {
        expect((err as RelicError).code).toBe(ErrorCodes.MISSING_ARTIFACT);
      }
    });

    test("throws if master key env var is missing", async () => {
      const artifact = await encryptPayload(
        "dummy",
        "{}",
        { iterations: TEST_ITERATIONS }
      );
      process.env.RELIC_ARTIFACT = artifact;
      delete process.env.RELIC_MASTER_KEY;

      const relic = createRelic();

      await expect(relic.load()).rejects.toThrow(RelicError);

      try {
        await relic.load();
      } catch (err) {
        expect((err as RelicError).code).toBe(ErrorCodes.MISSING_MASTER_KEY);
      }
    });
  });

  describe("caching", () => {
    test("caches decrypted secrets by default", async () => {
      const masterKey = "cache-key";
      const secrets = { CACHED: "value" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey });

      // Load twice
      const result1 = await relic.load();
      const result2 = await relic.load();

      // Should return the same cached object
      expect(result1).toBe(result2);
    });

    test("does not cache when cache=false", async () => {
      const masterKey = "no-cache-key";
      const secrets = { NOT_CACHED: "value" };
      const artifact = await encryptPayload(
        masterKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey, cache: false });

      // Load twice
      const result1 = await relic.load();
      const result2 = await relic.load();

      // Should return equal but different objects (re-decrypted)
      expect(result1).toEqual(result2);
      expect(result1).not.toBe(result2);
    });
  });

  describe("error handling", () => {
    test("throws on wrong master key", async () => {
      const correctKey = "correct";
      const wrongKey = "wrong";
      const secrets = { SECRET: "value" };
      const artifact = await encryptPayload(
        correctKey,
        JSON.stringify(secrets),
        { iterations: TEST_ITERATIONS }
      );

      const relic = createRelic({ artifact, masterKey: wrongKey });

      await expect(relic.load()).rejects.toThrow(RelicError);

      try {
        await relic.load();
      } catch (err) {
        expect((err as RelicError).code).toBe(ErrorCodes.DECRYPT_FAILED);
      }
    });

    test("throws on corrupted artifact", async () => {
      const masterKey = "corrupt-key";

      const relic = createRelic({
        artifact: "not valid json envelope",
        masterKey,
      });

      await expect(relic.load()).rejects.toThrow(RelicError);
    });
  });
});
