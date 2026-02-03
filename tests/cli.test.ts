import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { decryptPayload } from "../src/index.ts";

// Use a unique temp directory for each test run
const TEST_DIR = join(tmpdir(), `relic-cli-test-${Date.now()}`);
const ARTIFACT_FILE = join(TEST_DIR, "config", "relic.enc");
const MASTER_KEY = "test-cli-master-key-12345";

// Low iterations for fast tests
const TEST_ITERATIONS = 1000;

describe("CLI", () => {
  beforeEach(() => {
    // Create test directory
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("relic edit", () => {
    test("creates new artifact file with empty object", async () => {
      // Create a fake editor script that writes specific content
      const editorScript = join(TEST_DIR, "editor.sh");
      writeFileSync(
        editorScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "API_KEY": "new-secret-value"
}
EOF
`,
        { mode: 0o755 }
      );

      const proc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: editorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        console.error("CLI failed:", stderr);
      }

      expect(exitCode).toBe(0);
      expect(existsSync(ARTIFACT_FILE)).toBe(true);

      // Verify the artifact can be decrypted
      const artifact = readFileSync(ARTIFACT_FILE, "utf-8");
      const decrypted = await decryptPayload(MASTER_KEY, artifact);
      const data = JSON.parse(decrypted);

      expect(data.API_KEY).toBe("new-secret-value");
    });

    test("edits existing artifact file", async () => {
      // First, create an initial artifact
      const initialScript = join(TEST_DIR, "initial-editor.sh");
      writeFileSync(
        initialScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "INITIAL_KEY": "initial-value"
}
EOF
`,
        { mode: 0o755 }
      );

      // Create initial artifact
      const createProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: initialScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      // Now update the artifact with a new editor script
      const updateScript = join(TEST_DIR, "update-editor.sh");
      writeFileSync(
        updateScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "INITIAL_KEY": "initial-value",
  "NEW_KEY": "added-value"
}
EOF
`,
        { mode: 0o755 }
      );

      const updateProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: updateScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await updateProc.exited;

      // Verify updated content
      const artifact = readFileSync(ARTIFACT_FILE, "utf-8");
      const decrypted = await decryptPayload(MASTER_KEY, artifact);
      const data = JSON.parse(decrypted);

      expect(data.INITIAL_KEY).toBe("initial-value");
      expect(data.NEW_KEY).toBe("added-value");
    });

    test("fails without master key", async () => {
      const proc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: undefined, // Explicitly unset
          RELIC_EDITOR: "true", // No-op editor
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("RELIC_MASTER_KEY");
    });

    test("fails if editor produces invalid JSON", async () => {
      // Create editor script that produces invalid JSON
      const badEditorScript = join(TEST_DIR, "bad-editor.sh");
      writeFileSync(
        badEditorScript,
        `#!/bin/bash
echo "not valid json" > "$1"
`,
        { mode: 0o755 }
      );

      const proc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: badEditorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not valid JSON");
    });

    test("does not overwrite on invalid JSON", async () => {
      // First, create a valid artifact
      const goodEditorScript = join(TEST_DIR, "good-editor.sh");
      writeFileSync(
        goodEditorScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "ORIGINAL": "value"
}
EOF
`,
        { mode: 0o755 }
      );

      const createProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: goodEditorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      // Get the artifact contents
      const originalArtifact = readFileSync(ARTIFACT_FILE, "utf-8");

      // Now try to update with invalid JSON
      const badEditorScript = join(TEST_DIR, "bad-editor.sh");
      writeFileSync(
        badEditorScript,
        `#!/bin/bash
echo "invalid json" > "$1"
`,
        { mode: 0o755 }
      );

      const badProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: badEditorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await badProc.exited;

      // Artifact should be unchanged
      const currentArtifact = readFileSync(ARTIFACT_FILE, "utf-8");
      expect(currentArtifact).toBe(originalArtifact);
    });
  });

  describe("relic --print-keys", () => {
    test("prints secret keys without values", async () => {
      // First create an artifact
      const editorScript = join(TEST_DIR, "editor.sh");
      writeFileSync(
        editorScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "API_KEY": "secret1",
  "DB_PASSWORD": "secret2",
  "FEATURE_FLAG": true
}
EOF
`,
        { mode: 0o755 }
      );

      const createProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "edit", "--file", ARTIFACT_FILE, "--iterations", String(TEST_ITERATIONS)], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: editorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      // Now print keys
      const printProc = Bun.spawn(["bun", "run", "./src/cli/index.ts", "--print-keys", "--file", ARTIFACT_FILE], {
        cwd: dirname(dirname(import.meta.path)),
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await printProc.exited;
      const stdout = await new Response(printProc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("API_KEY");
      expect(stdout).toContain("DB_PASSWORD");
      expect(stdout).toContain("FEATURE_FLAG");
      // Should NOT contain actual values
      expect(stdout).not.toContain("secret1");
      expect(stdout).not.toContain("secret2");
    });
  });
});
