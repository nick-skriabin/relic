import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Miniflare } from "miniflare";
import { encryptPayload } from "../src/index.ts";
import { join, dirname } from "node:path";

// Use low iterations for faster tests
const TEST_ITERATIONS = 1000;

describe("Edge Runtime (Miniflare)", () => {
  let mf: Miniflare;
  let testArtifact: string;
  const MASTER_KEY = "edge-test-master-key";
  const SECRETS = {
    API_KEY: "edge-secret-123",
    DEBUG: true,
    COUNT: 42,
  };

  beforeAll(async () => {
    // Create test artifact
    testArtifact = await encryptPayload(MASTER_KEY, JSON.stringify(SECRETS), {
      iterations: TEST_ITERATIONS,
    });

    // Build the runtime bundle for edge as IIFE to avoid export conflicts
    const projectRoot = dirname(dirname(import.meta.path));
    const buildResult = await Bun.build({
      entrypoints: [join(projectRoot, "src/index.ts")],
      target: "browser",
      format: "esm",
      minify: false,
      naming: "[name].[ext]",
    });

    if (!buildResult.success) {
      throw new Error("Failed to build runtime for edge: " + buildResult.logs.join("\n"));
    }

    let runtimeCode = await buildResult.outputs[0]!.text();

    // Transform the exports into global assignments so they're accessible in the worker
    // The bundle exports named exports, we need to capture them
    runtimeCode = runtimeCode.replace(
      /export\s*\{([^}]+)\}/,
      (_match, exports) => {
        const exportList = exports.split(",").map((e: string) => e.trim());
        const assignments = exportList
          .map((e: string) => {
            const parts = e.split(/\s+as\s+/);
            const localName = parts[0]!.trim();
            const exportName = (parts[1] || parts[0])!.trim();
            return `globalThis.${exportName} = ${localName};`;
          })
          .join("\n");
        return assignments;
      }
    );

    // Create a worker script that includes the runtime code inline
    const workerScript = `
      // === INLINED RELIC RUNTIME ===
      ${runtimeCode}

      // === WORKER HANDLER ===
      export default {
        async fetch(request, env) {
          const url = new URL(request.url);
          const testName = url.pathname.slice(1);

          try {
            const { createRelic, ErrorCodes } = globalThis;

            switch (testName) {
              case "load": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                const secrets = await relic.load();
                return Response.json({ success: true, data: secrets });
              }

              case "get": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                const value = await relic.get("API_KEY");
                return Response.json({ success: true, value });
              }

              case "has": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                const hasKey = await relic.has("API_KEY");
                const hasMissing = await relic.has("NONEXISTENT");
                return Response.json({ success: true, hasKey, hasMissing });
              }

              case "keys": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                const keys = await relic.keys();
                return Response.json({ success: true, keys });
              }

              case "wrong-key": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: "wrong-key",
                });
                try {
                  await relic.load();
                  return Response.json({ success: false, error: "Should have thrown" });
                } catch (err) {
                  if (err.code === ErrorCodes.DECRYPT_FAILED) {
                    return Response.json({ success: true, errorCode: err.code });
                  }
                  return Response.json({ success: false, error: err.message });
                }
              }

              case "missing-key": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                try {
                  await relic.get("NONEXISTENT");
                  return Response.json({ success: false, error: "Should have thrown" });
                } catch (err) {
                  if (err.code === ErrorCodes.KEY_NOT_FOUND) {
                    return Response.json({ success: true, errorCode: err.code });
                  }
                  return Response.json({ success: false, error: err.message });
                }
              }

              case "caching": {
                const relic = createRelic({
                  artifact: env.RELIC_ARTIFACT,
                  masterKey: env.RELIC_MASTER_KEY,
                  cache: true,
                });
                const result1 = await relic.load();
                const result2 = await relic.load();
                return Response.json({
                  success: true,
                  equal: JSON.stringify(result1) === JSON.stringify(result2)
                });
              }

              case "unicode": {
                const unicodeArtifact = env.UNICODE_ARTIFACT;
                const relic = createRelic({
                  artifact: unicodeArtifact,
                  masterKey: env.RELIC_MASTER_KEY,
                });
                const secrets = await relic.load();
                return Response.json({ success: true, data: secrets });
              }

              default:
                return Response.json({ success: false, error: "Unknown test" }, { status: 404 });
            }
          } catch (err) {
            return Response.json({
              success: false,
              error: err.message,
              code: err.code,
              stack: err.stack
            }, { status: 500 });
          }
        }
      };
    `;

    // Create unicode test artifact
    const unicodeSecrets = {
      emoji: "🔐",
      chinese: "中文",
      arabic: "العربية",
    };
    const unicodeArtifact = await encryptPayload(
      MASTER_KEY,
      JSON.stringify(unicodeSecrets),
      { iterations: TEST_ITERATIONS }
    );

    // Initialize Miniflare with the worker
    mf = new Miniflare({
      modules: true,
      script: workerScript,
      bindings: {
        RELIC_ARTIFACT: testArtifact,
        RELIC_MASTER_KEY: MASTER_KEY,
        UNICODE_ARTIFACT: unicodeArtifact,
      },
      compatibilityDate: "2024-01-01",
    });
  });

  afterAll(async () => {
    if (mf) {
      await mf.dispose();
    }
  });

  test("loads secrets in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/load");
    const data = (await res.json()) as { success: boolean; data: typeof SECRETS };

    expect(data.success).toBe(true);
    expect(data.data).toEqual(SECRETS);
  });

  test("get() works in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/get");
    const data = (await res.json()) as { success: boolean; value: string };

    expect(data.success).toBe(true);
    expect(data.value).toBe("edge-secret-123");
  });

  test("has() works in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/has");
    const data = (await res.json()) as { success: boolean; hasKey: boolean; hasMissing: boolean };

    expect(data.success).toBe(true);
    expect(data.hasKey).toBe(true);
    expect(data.hasMissing).toBe(false);
  });

  test("keys() works in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/keys");
    const data = (await res.json()) as { success: boolean; keys: string[] };

    expect(data.success).toBe(true);
    expect(data.keys.sort()).toEqual(["API_KEY", "COUNT", "DEBUG"]);
  });

  test("detects wrong key in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/wrong-key");
    const data = (await res.json()) as { success: boolean; errorCode: string };

    expect(data.success).toBe(true);
    expect(data.errorCode).toBe("RELIC_ERR_DECRYPT_FAILED");
  });

  test("detects missing key in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/missing-key");
    const data = (await res.json()) as { success: boolean; errorCode: string };

    expect(data.success).toBe(true);
    expect(data.errorCode).toBe("RELIC_ERR_KEY_NOT_FOUND");
  });

  test("caching works in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/caching");
    const data = (await res.json()) as { success: boolean; equal: boolean };

    expect(data.success).toBe(true);
    expect(data.equal).toBe(true);
  });

  test("handles unicode in edge runtime", async () => {
    const res = await mf.dispatchFetch("http://localhost/unicode");
    const data = (await res.json()) as { success: boolean; data: Record<string, string> };

    expect(data.success).toBe(true);
    expect(data.data.emoji).toBe("🔐");
    expect(data.data.chinese).toBe("中文");
    expect(data.data.arabic).toBe("العربية");
  });
});
