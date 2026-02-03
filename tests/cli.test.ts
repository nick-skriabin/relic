import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { decryptPayload } from "../src/index.ts";

// Use a unique temp directory for each test run
const TEST_DIR = join(tmpdir(), `relic-cli-test-${Date.now()}`);
const PROJECT_ROOT = dirname(dirname(import.meta.path));
const CLI_PATH = join(PROJECT_ROOT, "src/cli/index.ts");
const MASTER_KEY = "test-cli-master-key-12345";

// Low iterations for fast tests
const TEST_ITERATIONS = 1000;

// Helper to get absolute path in test dir
const testPath = (relativePath: string) => join(TEST_DIR, relativePath);

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
      const artifactFile = testPath("config/relic.enc");
      const editorScript = testPath("editor.sh");

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

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
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
      expect(existsSync(artifactFile)).toBe(true);

      const artifact = readFileSync(artifactFile, "utf-8");
      const decrypted = await decryptPayload(MASTER_KEY, artifact);
      const data = JSON.parse(decrypted);

      expect(data.API_KEY).toBe("new-secret-value");
    });

    test("edits existing artifact file", async () => {
      const artifactFile = testPath("config/relic.enc");
      const initialScript = testPath("initial-editor.sh");

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

      const createProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: initialScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      const updateScript = testPath("update-editor.sh");
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

      const updateProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: updateScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await updateProc.exited;

      const artifact = readFileSync(artifactFile, "utf-8");
      const decrypted = await decryptPayload(MASTER_KEY, artifact);
      const data = JSON.parse(decrypted);

      expect(data.INITIAL_KEY).toBe("initial-value");
      expect(data.NEW_KEY).toBe("added-value");
    });

    test("fails without master key", async () => {
      const artifactFile = testPath("config/relic.enc");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: undefined,
          RELIC_EDITOR: "true",
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
      const artifactFile = testPath("config/relic.enc");
      const badEditorScript = testPath("bad-editor.sh");

      writeFileSync(
        badEditorScript,
        `#!/bin/bash
echo "not valid json" > "$1"
`,
        { mode: 0o755 }
      );

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
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
      const artifactFile = testPath("config/relic.enc");
      const goodEditorScript = testPath("good-editor.sh");

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

      const createProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: goodEditorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      const originalArtifact = readFileSync(artifactFile, "utf-8");

      const badEditorScript = testPath("bad-editor.sh");
      writeFileSync(
        badEditorScript,
        `#!/bin/bash
echo "invalid json" > "$1"
`,
        { mode: 0o755 }
      );

      const badProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: badEditorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await badProc.exited;

      const currentArtifact = readFileSync(artifactFile, "utf-8");
      expect(currentArtifact).toBe(originalArtifact);
    });
  });

  describe("relic init", () => {
    test("creates key file, artifact file, and adds key to gitignore", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");
      const gitignoreFile = testPath(".gitignore");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile, "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(existsSync(keyFile)).toBe(true);
      expect(existsSync(artifactFile)).toBe(true);
      expect(stdout).toContain("Generated master key");
      expect(stdout).toContain("Created encrypted secrets");
      expect(stdout).toContain(".gitignore");

      // Key should be valid base64
      const key = readFileSync(keyFile, "utf-8").trim();
      expect(key.length).toBeGreaterThan(20);
      expect(() => Buffer.from(key, "base64")).not.toThrow();

      // Artifact should be decryptable with the key
      const artifact = readFileSync(artifactFile, "utf-8");
      const decrypted = await decryptPayload(key, artifact);
      expect(JSON.parse(decrypted)).toEqual({});

      // Should be added to gitignore
      expect(existsSync(gitignoreFile)).toBe(true);
      const gitignore = readFileSync(gitignoreFile, "utf-8");
      expect(gitignore).toContain(keyFile);
    });

    test("fails if key file already exists", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");

      // Create key file first
      mkdirSync(dirname(keyFile), { recursive: true });
      writeFileSync(keyFile, "existing-key\n", "utf-8");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile, "--file", artifactFile], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).not.toBe(0);
      expect(stdout).toContain("already exists");
    });

    test("exits gracefully if artifact exists but key file does not (env var user)", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");

      // Create only artifact file (simulating env var user)
      mkdirSync(dirname(artifactFile), { recursive: true });
      writeFileSync(artifactFile, '{"v":1}', "utf-8");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile, "--file", artifactFile], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("RELIC_MASTER_KEY");
      expect(stdout).toContain("No initialization needed");
      // Key file should NOT be created
      expect(existsSync(keyFile)).toBe(false);
    });

    test("fails if artifact file already exists with key file", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");

      // Create only artifact file (key file doesn't exist yet, but will try to create)
      mkdirSync(dirname(artifactFile), { recursive: true });
      writeFileSync(artifactFile, '{"v":1}', "utf-8");
      // Now also create key file to trigger the "both exist" check
      writeFileSync(keyFile, "key\n", "utf-8");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile, "--file", artifactFile], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).not.toBe(0);
      expect(stdout).toContain("already exists");
    });

    test("does not duplicate gitignore entry", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");
      const gitignoreFile = testPath(".gitignore");

      // Create gitignore with existing entry
      writeFileSync(gitignoreFile, `${keyFile}\nnode_modules\n`, "utf-8");

      const proc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile, "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("already in .gitignore");

      // Should not have duplicate
      const gitignore = readFileSync(gitignoreFile, "utf-8");
      const escapedKeyFile = keyFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = gitignore.match(new RegExp(escapedKeyFile, "g"));
      expect(matches?.length).toBe(1);
    });
  });

  describe("key file usage", () => {
    test("uses key file when present instead of env var", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");

      // Initialize to create key file
      const initProc = Bun.spawn(["bun", "run", CLI_PATH, "init", "--key-file", keyFile], {
        cwd: TEST_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      await initProc.exited;

      // Read the generated key
      const generatedKey = readFileSync(keyFile, "utf-8").trim();

      // Create editor script
      const editorScript = testPath("editor.sh");
      writeFileSync(
        editorScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "SECRET": "from-key-file"
}
EOF
`,
        { mode: 0o755 }
      );

      // Edit without setting RELIC_MASTER_KEY - should use key file
      const editProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--key-file", keyFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: undefined,
          RELIC_EDITOR: editorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await editProc.exited;
      expect(exitCode).toBe(0);

      // Verify artifact can be decrypted with the generated key
      const artifact = readFileSync(artifactFile, "utf-8");
      const decrypted = await decryptPayload(generatedKey, artifact);
      const data = JSON.parse(decrypted);

      expect(data.SECRET).toBe("from-key-file");
    });

    test("prefers key file over env var", async () => {
      const keyFile = testPath("config/relic.key");
      const artifactFile = testPath("config/relic.enc");

      // Create key file with specific key
      mkdirSync(dirname(keyFile), { recursive: true });
      const fileKey = "file-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      writeFileSync(keyFile, fileKey + "\n", "utf-8");

      const editorScript = testPath("editor.sh");
      writeFileSync(
        editorScript,
        `#!/bin/bash
cat > "$1" << 'EOF'
{
  "TEST": "value"
}
EOF
`,
        { mode: 0o755 }
      );

      // Set both env var and key file - key file should win
      const editProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--key-file", keyFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: "env-key-should-not-be-used",
          RELIC_EDITOR: editorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await editProc.exited;

      // Should decrypt with file key, not env key
      const artifact = readFileSync(artifactFile, "utf-8");
      const decrypted = await decryptPayload(fileKey, artifact);
      expect(JSON.parse(decrypted).TEST).toBe("value");

      // Should NOT decrypt with env key
      await expect(decryptPayload("env-key-should-not-be-used", artifact)).rejects.toThrow();
    });
  });

  describe("relic --print-keys", () => {
    test("prints secret keys without values", async () => {
      const artifactFile = testPath("config/relic.enc");
      const editorScript = testPath("editor.sh");

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

      const createProc = Bun.spawn(["bun", "run", CLI_PATH, "edit", "--file", artifactFile, "--iterations", String(TEST_ITERATIONS)], {
        cwd: TEST_DIR,
        env: {
          ...process.env,
          RELIC_MASTER_KEY: MASTER_KEY,
          RELIC_EDITOR: editorScript,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      await createProc.exited;

      const printProc = Bun.spawn(["bun", "run", CLI_PATH, "--print-keys", "--file", artifactFile], {
        cwd: TEST_DIR,
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
      expect(stdout).not.toContain("secret1");
      expect(stdout).not.toContain("secret2");
    });
  });
});
