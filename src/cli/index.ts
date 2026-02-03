#!/usr/bin/env node
/**
 * Relic CLI - Edit encrypted secrets
 *
 * Usage: relic edit [--file <path>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
function parseArgs(): { command: string; file: string; printKeys: boolean; iterations?: number } {
  const args = process.argv.slice(2);
  let command = "edit";
  let file: string = Defaults.ARTIFACT_FILE;
  let printKeys = false;
  let iterations: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "edit") {
      command = "edit";
    } else if (arg === "--print-keys") {
      printKeys = true;
      command = "print-keys";
    } else if (arg === "--file" || arg === "-f") {
      file = args[++i] || file;
    } else if (arg === "--iterations") {
      // Hidden flag for testing - allows lower iterations for faster tests
      iterations = parseInt(args[++i] || "", 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { command, file, printKeys, iterations };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
relic - Rails-credentials-like encrypted secrets for JS apps

Usage:
  relic edit [options]     Edit secrets (default command)
  relic --print-keys       Print all secret keys (not values)

Options:
  --file, -f <path>        Artifact file path (default: config/relic.enc)
  --help, -h               Show this help message

Environment:
  RELIC_MASTER_KEY         Master key for encryption/decryption (required)
  RELIC_EDITOR             Override editor command
  EDITOR                   Editor to use (fallback)

Examples:
  relic edit               Edit secrets using $EDITOR
  relic --file secrets.enc Edit a custom secrets file
  relic --print-keys       List all secret keys
`);
}

/**
 * Get the master key from environment
 */
function getMasterKey(): string {
  const key = process.env[Defaults.MASTER_KEY_ENV];
  if (!key) {
    console.error(`Error: ${Defaults.MASTER_KEY_ENV} environment variable is not set`);
    process.exit(1);
  }
  return key;
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
async function editCommand(filePath: string, iterations?: number): Promise<void> {
  const masterKey = getMasterKey();
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
async function printKeysCommand(filePath: string): Promise<void> {
  const masterKey = getMasterKey();
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
  const { command, file, iterations } = parseArgs();

  switch (command) {
    case "edit":
      await editCommand(file, iterations);
      break;
    case "print-keys":
      await printKeysCommand(file);
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
