#!/usr/bin/env node
/**
 * Relic CLI - Edit encrypted secrets
 *
 * Usage:
 *   relic init              Initialize relic for local development
 *   relic edit [--file]     Edit secrets
 *   relic --print-keys      Print all secret keys
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { encryptPayload, decryptPayload } from "../crypto.ts";
import { Defaults } from "../types.ts";
import { RelicError } from "../errors.ts";

/**
 * Get the editor command
 */
function getEditor(): string {
  // Check RELIC_EDITOR first (for testing)
  if (process.env.RELIC_EDITOR) {
    return process.env.RELIC_EDITOR;
  }
  // Then check standard EDITOR
  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }
  // Fallback based on platform
  return process.platform === "win32" ? "notepad" : "vi";
}

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string; file: string; keyFile: string; printKeys: boolean; iterations?: number } {
  const args = process.argv.slice(2);
  let command = "edit";
  let file: string = Defaults.ARTIFACT_FILE;
  let keyFile: string = Defaults.KEY_FILE;
  let printKeys = false;
  let iterations: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "init") {
      command = "init";
    } else if (arg === "edit") {
      command = "edit";
    } else if (arg === "--print-keys") {
      printKeys = true;
      command = "print-keys";
    } else if (arg === "--file" || arg === "-f") {
      file = args[++i] || file;
    } else if (arg === "--key-file" || arg === "-k") {
      keyFile = args[++i] || keyFile;
    } else if (arg === "--iterations") {
      // Hidden flag for testing - allows lower iterations for faster tests
      iterations = parseInt(args[++i] || "", 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { command, file, keyFile, printKeys, iterations };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
relic - Rails-credentials-like encrypted secrets for JS apps

Usage:
  relic init [options]       Initialize relic (generates key file)
  relic edit [options]       Edit secrets (default command)
  relic --print-keys         Print all secret keys (not values)

Options:
  --file, -f <path>          Artifact file path (default: config/relic.enc)
  --key-file, -k <path>      Key file path (default: config/relic.key)
  --help, -h                 Show this help message

Key Resolution (in order):
  1. Key file (config/relic.key) - for local development
  2. RELIC_MASTER_KEY env var - for CI/production

Environment:
  RELIC_MASTER_KEY           Master key for encryption/decryption
  RELIC_EDITOR               Override editor command
  EDITOR                     Editor to use (fallback)

Examples:
  relic init                 Generate key file for local development
  relic edit                 Edit secrets using $EDITOR
  relic --file secrets.enc   Edit a custom secrets file
  relic --print-keys         List all secret keys
`);
}

/**
 * Get the key file path
 */
function getKeyFilePath(keyFile: string): string {
  return resolve(process.cwd(), keyFile);
}

/**
 * Get the master key from key file or environment
 */
function getMasterKey(keyFile: string): string {
  const keyFilePath = getKeyFilePath(keyFile);

  // First, check for key file
  if (existsSync(keyFilePath)) {
    const key = readFileSync(keyFilePath, "utf-8").trim();
    if (key) {
      return key;
    }
  }

  // Fall back to environment variable
  const envKey = process.env[Defaults.MASTER_KEY_ENV];
  if (envKey) {
    return envKey;
  }

  console.error(`Error: No master key found.

To set up for local development:
  relic init

Or set the environment variable:
  export ${Defaults.MASTER_KEY_ENV}=<your-key>
`);
  process.exit(1);
}

/**
 * Generate a secure random key
 */
function generateKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Add a pattern to .gitignore if not already present
 */
function addToGitignore(pattern: string): boolean {
  const gitignorePath = resolve(process.cwd(), ".gitignore");

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map(l => l.trim());

    if (lines.includes(pattern)) {
      return false; // Already in .gitignore
    }

    // Add to .gitignore with a newline if needed
    const needsNewline = content.length > 0 && !content.endsWith("\n");
    appendFileSync(gitignorePath, `${needsNewline ? "\n" : ""}${pattern}\n`, "utf-8");
  } else {
    // Create .gitignore
    writeFileSync(gitignorePath, `${pattern}\n`, "utf-8");
  }

  return true;
}

/**
 * Initialize relic for local development
 */
async function initCommand(keyFile: string, artifactFile: string, iterations?: number): Promise<void> {
  const keyFilePath = resolve(process.cwd(), keyFile);
  const artifactFilePath = resolve(process.cwd(), artifactFile);

  const keyExists = existsSync(keyFilePath);
  const artifactExists = existsSync(artifactFilePath);

  // If artifact exists but key file doesn't, user likely uses env var
  if (artifactExists && !keyExists) {
    console.log(`Artifact file exists: ${artifactFile}`);
    console.log(`Key file not found: ${keyFile}`);
    console.log("");
    console.log("It looks like you're using RELIC_MASTER_KEY environment variable.");
    console.log("No initialization needed for this setup.");
    process.exit(0);
  }

  // If both exist, already initialized
  if (keyExists && artifactExists) {
    console.log("Relic is already initialized.");
    console.log(`  Key file: ${keyFile}`);
    console.log(`  Artifact: ${artifactFile}`);
    process.exit(0);
  }

  // If key exists but artifact doesn't, create artifact using existing key
  if (keyExists && !artifactExists) {
    const key = readFileSync(keyFilePath, "utf-8").trim();

    const artifactDir = dirname(artifactFilePath);
    if (!existsSync(artifactDir)) {
      mkdirSync(artifactDir, { recursive: true });
    }

    const emptySecrets = JSON.stringify({}, null, 2) + "\n";
    const encryptOptions = iterations ? { iterations } : undefined;
    const artifact = await encryptPayload(key, emptySecrets, encryptOptions);
    writeFileSync(artifactFilePath, artifact, "utf-8");
    console.log(`✓ Created encrypted secrets: ${artifactFile}`);
    console.log(`  (using existing key from ${keyFile})`);
    return;
  }

  // Neither exists - full initialization
  const key = generateKey();

  // Ensure directories exist
  const keyDir = dirname(keyFilePath);
  if (!existsSync(keyDir)) {
    mkdirSync(keyDir, { recursive: true });
  }

  const artifactDir = dirname(artifactFilePath);
  if (!existsSync(artifactDir)) {
    mkdirSync(artifactDir, { recursive: true });
  }

  // Write key file
  writeFileSync(keyFilePath, key + "\n", "utf-8");
  console.log(`✓ Generated master key: ${keyFile}`);

  // Create encrypted artifact with empty JSON
  const emptySecrets = JSON.stringify({}, null, 2) + "\n";
  const encryptOptions = iterations ? { iterations } : undefined;
  const artifact = await encryptPayload(key, emptySecrets, encryptOptions);
  writeFileSync(artifactFilePath, artifact, "utf-8");
  console.log(`✓ Created encrypted secrets: ${artifactFile}`);

  // Add key file to .gitignore
  const added = addToGitignore(keyFile);
  if (added) {
    console.log(`✓ Added ${keyFile} to .gitignore`);
  } else {
    console.log(`✓ ${keyFile} already in .gitignore`);
  }

  console.log(`
Setup complete! You can now:

  relic edit          Edit your secrets

For production, set the RELIC_MASTER_KEY environment variable:

  export RELIC_MASTER_KEY=$(cat ${keyFile})
`);
}

/**
 * Create a temporary file path
 */
function createTempFile(): string {
  const id = randomBytes(8).toString("hex");
  return resolve(tmpdir(), `relic-edit-${id}.json`);
}

/**
 * Open editor on a file and wait for it to close
 */
async function openEditor(filePath: string): Promise<void> {
  const editor = getEditor();
  const parts = editor.split(" ");
  const cmd = parts[0]!;
  const cmdArgs = [...parts.slice(1), filePath];

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to open editor: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });
  });
}

/**
 * Validate and format JSON
 */
function validateAndFormatJson(content: string): string {
  const data = JSON.parse(content);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Secrets must be a JSON object");
  }
  // Pretty format with 2 spaces, trailing newline
  return JSON.stringify(data, null, 2) + "\n";
}

/**
 * Main edit command
 */
async function editCommand(filePath: string, keyFile: string, iterations?: number): Promise<void> {
  const masterKey = getMasterKey(keyFile);
  const absolutePath = resolve(process.cwd(), filePath);

  let plaintext = "{}";

  // Read existing artifact if it exists
  if (existsSync(absolutePath)) {
    try {
      const artifact = readFileSync(absolutePath, "utf-8");
      plaintext = await decryptPayload(masterKey, artifact);
    } catch (err) {
      if (err instanceof RelicError) {
        console.error(`Error: ${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    }
  }

  // Format the plaintext
  try {
    plaintext = validateAndFormatJson(plaintext);
  } catch {
    console.error("Error: Existing secrets file contains invalid JSON");
    process.exit(1);
  }

  // Write to temp file
  const tempFile = createTempFile();
  writeFileSync(tempFile, plaintext, "utf-8");

  try {
    // Open editor
    await openEditor(tempFile);

    // Read edited content
    const edited = readFileSync(tempFile, "utf-8");

    // Validate and format
    let formatted: string;
    try {
      formatted = validateAndFormatJson(edited);
    } catch (err) {
      console.error("Error: Edited content is not valid JSON");
      // Don't overwrite on invalid JSON
      process.exit(1);
    }

    // Encrypt and write back
    const encryptOptions = iterations ? { iterations } : undefined;
    const artifact = await encryptPayload(masterKey, formatted, encryptOptions);

    // Ensure directory exists
    const dir = dirname(absolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(absolutePath, artifact, "utf-8");
    console.log(`Secrets saved to ${filePath}`);
  } finally {
    // Cleanup temp file
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Print keys command
 */
async function printKeysCommand(filePath: string, keyFile: string): Promise<void> {
  const masterKey = getMasterKey(keyFile);
  const absolutePath = resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    console.error(`Error: Artifact file not found: ${filePath}`);
    process.exit(1);
  }

  try {
    const artifact = readFileSync(absolutePath, "utf-8");
    const plaintext = await decryptPayload(masterKey, artifact);
    const data = JSON.parse(plaintext);

    console.log("Secret keys:");
    for (const key of Object.keys(data)) {
      console.log(`  - ${key}`);
    }
  } catch (err) {
    if (err instanceof RelicError) {
      console.error(`Error: ${err.message} (${err.code})`);
    } else if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, file, keyFile, iterations } = parseArgs();

  switch (command) {
    case "init":
      await initCommand(keyFile, file, iterations);
      break;
    case "edit":
      await editCommand(file, keyFile, iterations);
      break;
    case "print-keys":
      await printKeysCommand(file, keyFile);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
