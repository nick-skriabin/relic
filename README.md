<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/locked-with-key_1f510.png" width="120" height="120" alt="Relic">
</p>

<h1 align="center">Relic</h1>

<p align="center">
  <strong>Encrypted secrets for JavaScript apps</strong><br>
  <em>Inspired by Rails credentials. Built for the Edge.</em>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#cli">CLI</a> •
  <a href="#api">API</a> •
  <a href="#edge-runtimes">Edge</a> •
  <a href="#security">Security</a>
</p>

<p align="center">
  <a href="https://github.com/nick-skriabin/relic/actions/workflows/ci.yml"><img src="https://github.com/nick-skriabin/relic/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@nick-skriabin/relic"><img src="https://img.shields.io/npm/v/@nick-skriabin/relic?color=cb3837&logo=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/Bun-1.0+-f9f1e1?logo=bun&logoColor=black" alt="Bun">
  <img src="https://img.shields.io/badge/Edge-Ready-orange?logo=cloudflare&logoColor=white" alt="Edge Ready">
  <img src="https://img.shields.io/badge/TypeScript-First-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
</p>

---

## Table of Contents

- [Why Relic?](#why-relic)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI](#cli)
  - [Commands](#commands)
  - [Local Development Setup](#local-development-setup)
  - [Key Resolution Order](#key-resolution-order)
  - [Editor Configuration](#editor-configuration)
  - [Default File Locations](#default-file-locations)
  - [Local Overrides](#local-overrides)
  - [Public Secrets (Frontend-Safe)](#public-secrets-frontend-safe)
- [API](#api)
  - [`createRelic(options?)`](#createrelicopts)
  - [Instance Methods](#instance-methods)
  - [Low-Level Functions](#low-level-functions)
- [Edge Runtimes](#edge-runtimes)
  - [Next.js](#nextjs-edge-runtime--middleware)
  - [Cloudflare Workers](#cloudflare-workers)
  - [Vite / Nuxt / SvelteKit](#vite--nuxt--sveltekit)
  - [Deno](#deno--deno-deploy)
- [Error Handling](#error-handling)
- [Security](#security)
  - [Cryptographic Details](#cryptographic-details)
  - [Artifact Format](#artifact-format)
  - [Best Practices](#best-practices)
  - [Key Rotation](#key-rotation)
  - [Threat Model](#threat-model)
- [Comparison](#comparison)
- [Troubleshooting](#troubleshooting)
- [TypeScript](#typescript)
  - [Auto-Generated Types](#auto-generated-types)
  - [Manual Typing](#manual-typing)

---

## Why Relic?

Managing secrets in JavaScript applications is painful. Environment variables scatter across `.env` files, CI configs, and deployment dashboards. Relic takes a different approach:

![Relic](./screenshots/relic.jpg)

**One encrypted file. One master key. Git-friendly diffs. Works everywhere.**

### Features

| Feature | Description |
|---------|-------------|
| **🔐 Strong Encryption** | AES-256-GCM with PBKDF2 key derivation (600k iterations) |
| **🌐 Edge Compatible** | Web Crypto API only — runs on Cloudflare Workers, Vercel Edge, Deno Deploy |
| **📦 Single Artifact** | One JSON file containing all your secrets, safe to commit |
| **📝 Git-Friendly** | Per-value encryption keeps keys visible — meaningful diffs and easy merges |
| **🛠️ Familiar Workflow** | Edit secrets with `$EDITOR`, just like Rails credentials |
| **✅ Tamper-Proof** | Authenticated encryption detects any modification |
| **🪶 Zero Dependencies** | ~7KB runtime, no external packages |

---

## Installation

```bash
# npm
npm install @nick-skriabin/relic

# pnpm
pnpm add @nick-skriabin/relic

# yarn
yarn add @nick-skriabin/relic

# bun
bun add @nick-skriabin/relic
```

---

## Quick Start

### 1. Initialize Relic

```bash
npx relic init
```

This generates a master key and saves it to `config/relic.key` (automatically added to `.gitignore`, along with `config/relic.local.json`).

### 2. Create Your Secrets

```bash
npx relic edit
```

Your editor opens with an empty JSON object. Add your secrets:

```json
{
  "DATABASE_URL": "postgres://user:pass@host:5432/db",
  "API_KEY": "sk_live_xxxxxxxxxxxxx",
  "STRIPE_SECRET": "sk_live_xxxxxxxxxxxxx",
  "JWT_SECRET": "your-jwt-secret-here"
}
```

Save and close. Relic encrypts and writes to `config/relic.enc`.

### 3. Use in Your App

```typescript
import { createRelic } from "@nick-skriabin/relic";

const relic = createRelic();

// Load all secrets
const secrets = await relic.load();
console.log(secrets.DATABASE_URL);

// Or get individual values
const apiKey = await relic.get("API_KEY");
```

### 4. Deploy

Set two environment variables in production:

| Variable | Value |
|----------|-------|
| `RELIC_MASTER_KEY` | Your master key (from `config/relic.key`) |
| `RELIC_ARTIFACT` | Contents of `config/relic.enc` |

#### Vercel (Node.js runtime)

Since the artifact is committed to your repo, Relic can read it directly. You only need to set `RELIC_MASTER_KEY`:

1. Add `RELIC_MASTER_KEY` to Vercel Environment Variables (Settings → Environment Variables)
   ```bash
   cat config/relic.key  # Copy this value
   ```

2. Use `artifactPath` to read from the committed file:
   ```typescript
   // lib/relic.ts
   import { createRelic } from "@nick-skriabin/relic";

   export const relic = createRelic({
     artifactPath: "./config/relic.enc",
   });
   ```

3. Use anywhere in your app:
   ```typescript
   import { relic } from "@/lib/relic";

   const secrets = await relic.load();
   ```

#### Vercel Edge Runtime

Edge functions don't have filesystem access. Bundle the artifact at build time instead.

**Next.js setup:**

1. Configure webpack to handle `.enc` files in `next.config.js`:
   ```js
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     webpack: (config) => {
       config.module.rules.push({
         test: /\.enc$/,
         type: "asset/source",
       });
       return config;
     },
   };

   module.exports = nextConfig;
   ```

2. Add type declaration (optional, for TypeScript):
   ```typescript
   // types/assets.d.ts
   declare module "*.enc" {
     const content: string;
     export default content;
   }
   ```

3. Import and use:
   ```typescript
   // lib/relic.ts
   import { createRelic } from "@nick-skriabin/relic";
   import artifact from "../config/relic.enc";

   export const relic = createRelic({
     artifact,
   });
   ```

**Vite setup:**

Vite supports raw imports natively:

```typescript
import { createRelic } from "@nick-skriabin/relic";
import artifact from "./config/relic.enc?raw";

export const relic = createRelic({
  artifact,
});
```

#### Cloudflare Workers

```bash
# Using wrangler secrets
wrangler secret put RELIC_MASTER_KEY
wrangler secret put RELIC_ARTIFACT

# Or in wrangler.toml (not recommended for secrets)
[vars]
RELIC_ARTIFACT = "..."
```

#### Other Platforms

```bash
# Generic - export from local files
export RELIC_MASTER_KEY=$(cat config/relic.key)
export RELIC_ARTIFACT=$(cat config/relic.enc)

# Docker
docker run -e RELIC_MASTER_KEY="$(cat config/relic.key)" \
           -e RELIC_ARTIFACT="$(cat config/relic.enc)" \
           your-image

# GitHub Actions (add as repository secrets, then reference)
env:
  RELIC_MASTER_KEY: ${{ secrets.RELIC_MASTER_KEY }}
  RELIC_ARTIFACT: ${{ secrets.RELIC_ARTIFACT }}
```

---

## CLI

The CLI is the **only** way to modify secrets. This ensures secrets are always properly encrypted.

### Commands

```bash
# Initialize relic (generates key file)
relic init

# Edit secrets (creates file if it doesn't exist)
relic edit

# Edit a specific file
relic edit --file ./secrets/production.enc

# List all secret keys (without values)
relic --print-keys

# Show help
relic --help
```

### Local Development Setup

The `init` command sets up relic for local development:

```bash
relic init
```

This:
1. Generates a secure random master key
2. Saves it to `config/relic.key`
3. Adds `config/relic.key` and `config/relic.local.json` to `.gitignore`

Now you can use `relic edit` without setting environment variables.

### Key Resolution Order

Relic looks for the master key in this order:

1. **Key file** (`config/relic.key`) — for local development
2. **Environment variable** (`RELIC_MASTER_KEY`) — for CI/production

```
Local Development          Production/CI
─────────────────          ─────────────
config/relic.key    →      RELIC_MASTER_KEY env var
(auto-generated)           (from secrets manager)
```

### Editor Configuration

Relic uses your preferred editor:

```bash
# Uses these in order of preference:
# 1. $RELIC_EDITOR (for automation/CI)
# 2. $EDITOR
# 3. vi (Unix) / notepad (Windows)

export EDITOR=vim                    # Use Vim
export EDITOR="code --wait"          # Use VS Code
export EDITOR="subl --wait"          # Use Sublime Text
export EDITOR="nano"                 # Use Nano
```

### Default File Locations

```
your-project/
├── config/
│   ├── relic.key         ← Master key (git-ignored)
│   ├── relic.enc         ← Encrypted secrets (commit this)
│   ├── relic.d.ts        ← Auto-generated types (commit this)
│   └── relic.local.json  ← Local overrides (git-ignored, optional)
├── src/
└── package.json
```

Override with `--file` and `--key-file`:

```bash
relic init --key-file ./secrets/master.key
relic edit --file ./secrets/production.enc --key-file ./secrets/master.key
```

### Local Overrides

For local development, you can override encrypted secrets with a plain JSON file. This is useful when you need different values locally without modifying the shared encrypted artifact.

Create `config/relic.local.json` (add to `.gitignore`):

```json
{
  "DATABASE_URL": "postgres://localhost:5432/myapp_dev",
  "DEBUG": true
}
```

Values in `relic.local.json` are merged on top of encrypted secrets:

```typescript
// config/relic.enc contains: { "DATABASE_URL": "prod-url", "API_KEY": "secret" }
// config/relic.local.json contains: { "DATABASE_URL": "localhost", "DEBUG": true }

const secrets = await relic.load();
// Result: { "DATABASE_URL": "localhost", "API_KEY": "secret", "DEBUG": true }
```

**Resolution order:**
1. Load and decrypt `config/relic.enc`
2. Deep merge `config/relic.local.json` on top (if present)
3. Local values override encrypted values

To disable local overrides:

```typescript
const relic = createRelic({ localOverrides: false });
```

To use a custom path:

```typescript
const relic = createRelic({ localOverrides: "./secrets/local.json" });
```

### Public Secrets (Frontend-Safe)

Relic supports exposing certain secrets to the frontend via a special `public` key. This works similarly to `NEXT_PUBLIC_` environment variables in Next.js.

Structure your secrets with a `public` key:

```json
{
  "DATABASE_URL": "postgres://secret-host/db",
  "API_KEY": "sk_live_secret",
  "public": {
    "API_URL": "https://api.example.com",
    "APP_NAME": "My App",
    "STRIPE_PUBLIC_KEY": "pk_live_..."
  }
}
```

Use `loadPublic()` to get only the public secrets:

```typescript
// Server-side: access everything
const secrets = await relic.load();
secrets.DATABASE_URL;  // ✓ Available
secrets.public.API_URL; // ✓ Available

// Frontend-safe: only public secrets
const publicSecrets = await relic.loadPublic();
// => { API_URL: "...", APP_NAME: "...", STRIPE_PUBLIC_KEY: "..." }
```

**Next.js example:**

```typescript
// app/layout.tsx (Server Component)
import { relic } from "@/lib/relic";

export default async function RootLayout({ children }) {
  const publicSecrets = await relic.loadPublic();

  return (
    <html>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__PUBLIC_CONFIG__ = ${JSON.stringify(publicSecrets)}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
```

---

## API

### `createRelic(options?)`

Creates a Relic instance for accessing secrets.

```typescript
import { createRelic } from "@nick-skriabin/relic";

const relic = createRelic({
  // Read artifact from file (Node.js only)
  artifactPath: "./config/relic.enc",

  // Or provide artifact directly (for Edge/bundling)
  artifact: "...",

  // Or specify env var name (default: "RELIC_ARTIFACT")
  artifactEnv: "MY_SECRETS",

  // Provide master key directly
  masterKey: "...",

  // Or specify env var name (default: "RELIC_MASTER_KEY")
  masterKeyEnv: "MY_MASTER_KEY",

  // Cache decrypted secrets (default: true)
  cache: true,

  // Local overrides file path, or false to disable
  // (default: "config/relic.local.json")
  localOverrides: "./config/relic.local.json",
});
```

### Instance Methods

```typescript
// Load all secrets as an object
const secrets = await relic.load();
// => { API_KEY: "...", DATABASE_URL: "...", public: { ... } }

// Load only public secrets (safe for frontend)
const publicSecrets = await relic.loadPublic();
// => { API_URL: "...", APP_NAME: "..." }

// Get a specific secret (throws if not found)
const apiKey = await relic.get("API_KEY");

// Check if a secret exists
if (await relic.has("OPTIONAL_KEY")) {
  // ...
}

// List all available keys
const keys = await relic.keys();
// => ["API_KEY", "DATABASE_URL", "public", ...]
```

### Low-Level Functions

For advanced use cases, you can use the encryption functions directly:

```typescript
import { encryptPayload, decryptPayload } from "@nick-skriabin/relic";

// Encrypt
const artifact = await encryptPayload(
  "my-master-key",
  JSON.stringify({ secret: "value" })
);

// Decrypt
const plaintext = await decryptPayload("my-master-key", artifact);
const data = JSON.parse(plaintext);
```

---

## Edge Runtimes

Relic is designed from the ground up to work in Edge environments where Node.js APIs aren't available.

Since Edge runtimes don't have filesystem access, you need to bundle the artifact at build time. This keeps your secrets in the committed file (not in env vars) while still working in Edge.

### Next.js (Edge Runtime & Middleware)

1. Configure webpack in `next.config.js`:
   ```js
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     webpack: (config) => {
       config.module.rules.push({
         test: /\.enc$/,
         type: "asset/source",
       });
       return config;
     },
   };

   module.exports = nextConfig;
   ```

2. Create a shared relic instance:
   ```typescript
   // lib/relic.ts
   import { createRelic } from "@nick-skriabin/relic";
   import artifact from "../config/relic.enc";

   export const relic = createRelic({ artifact });
   ```

3. Use in Edge API routes:
   ```typescript
   // app/api/route.ts
   import { relic } from "@/lib/relic";

   export const runtime = "edge";

   export async function GET() {
     const secrets = await relic.load();
     return Response.json({ ok: true });
   }
   ```

4. Use in Middleware:
   ```typescript
   // middleware.ts
   import { relic } from "@/lib/relic";

   export async function middleware(request: Request) {
     const { API_KEY } = await relic.load();
     // Validate requests, add headers, etc.
   }

   export const config = {
     matcher: "/api/:path*",
   };
   ```

### Cloudflare Workers

```typescript
// src/worker.ts
import { createRelic } from "@nick-skriabin/relic";

// Bundled at build time (esbuild/wrangler handles this)
import artifact from "../config/relic.enc";

const relic = createRelic({
  artifact,
  masterKey: RELIC_MASTER_KEY, // from wrangler secret
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { API_KEY } = await relic.load();
    return new Response("OK");
  },
};
```

Configure wrangler to handle `.enc` files:
```toml
# wrangler.toml
[rules]
{ type = "Text", globs = ["**/*.enc"] }
```

Set the master key as a secret:
```bash
wrangler secret put RELIC_MASTER_KEY
```

### Vite / Nuxt / SvelteKit

Vite supports raw imports natively:

```typescript
import { createRelic } from "@nick-skriabin/relic";
import artifact from "./config/relic.enc?raw";

export const relic = createRelic({ artifact });
```

### Deno / Deno Deploy

```typescript
import { createRelic } from "npm:@nick-skriabin/relic";

// Deno supports reading files at module load time
const artifact = await Deno.readTextFile("./config/relic.enc");

const relic = createRelic({ artifact });

Deno.serve(async () => {
  const secrets = await relic.load();
  return new Response("OK");
});
```

---

## Error Handling

Relic throws `RelicError` with specific error codes for easy handling:

```typescript
import { createRelic, RelicError, ErrorCodes } from "@nick-skriabin/relic";

const relic = createRelic();

try {
  const secrets = await relic.load();
} catch (error) {
  if (error instanceof RelicError) {
    switch (error.code) {
      case ErrorCodes.MISSING_ARTIFACT:
        console.error("No artifact provided. Set RELIC_ARTIFACT env var.");
        break;

      case ErrorCodes.MISSING_MASTER_KEY:
        console.error("No master key. Set RELIC_MASTER_KEY env var.");
        break;

      case ErrorCodes.DECRYPT_FAILED:
        console.error("Wrong master key or corrupted artifact.");
        break;

      case ErrorCodes.INVALID_JSON:
        console.error("Artifact doesn't contain valid JSON.");
        break;

      case ErrorCodes.UNSUPPORTED_VERSION:
        console.error("Artifact version not supported. Update relic.");
        break;

      case ErrorCodes.KEY_NOT_FOUND:
        console.error(`Secret key not found: ${error.message}`);
        break;
    }
  }
  throw error;
}
```

### Error Codes Reference

| Code | Meaning |
|------|---------|
| `RELIC_ERR_MISSING_ARTIFACT` | No artifact provided and env var not set |
| `RELIC_ERR_MISSING_MASTER_KEY` | No master key provided and env var not set |
| `RELIC_ERR_DECRYPT_FAILED` | Decryption failed (wrong key or tampered data) |
| `RELIC_ERR_INVALID_JSON` | Decrypted content is not valid JSON |
| `RELIC_ERR_UNSUPPORTED_VERSION` | Artifact uses an unsupported format version |
| `RELIC_ERR_KEY_NOT_FOUND` | Requested secret key doesn't exist |
| `RELIC_ERR_INVALID_ARTIFACT_FORMAT` | Artifact structure is malformed |

---

## Security

### Cryptographic Details

| Component | Specification |
|-----------|---------------|
| **Cipher** | AES-256-GCM |
| **Key Derivation** | PBKDF2-SHA256, 600,000 iterations |
| **Salt** | 16 bytes, randomly generated |
| **IV/Nonce** | 12 bytes, randomly generated |
| **Auth Tag** | 128 bits (included in ciphertext) |

### Artifact Format

Relic uses **per-value encryption** — your JSON structure remains visible, only values are encrypted:

```json
{
  "API_KEY": "relic:v1:base64(iterations + salt + iv + ciphertext)...",
  "DATABASE_URL": "relic:v1:base64(iterations + salt + iv + ciphertext)...",
  "nested": {
    "SECRET": "relic:v1:base64(iterations + salt + iv + ciphertext)..."
  }
}
```

This format has several advantages:

- **Meaningful git diffs** — see which keys changed, not just "binary file modified"
- **Easy merge conflicts** — resolve conflicts by key, not by re-encrypting everything
- **Visible structure** — know what secrets exist without decrypting
- **Nested support** — organize secrets with nested objects

### Best Practices

#### ✅ Do

- **Commit the encrypted artifact** — it's safe and enables GitOps workflows
- **Store the master key in a secrets manager** — AWS Secrets Manager, HashiCorp Vault, 1Password, etc.
- **Use different master keys per environment** — `staging.enc` with staging key, `production.enc` with production key
- **Back up your master key** — losing it means losing access to all secrets
- **Rotate secrets regularly** — edit the artifact, re-encrypt with same key

#### ❌ Don't

- **Never commit the master key** — not in `.env`, not in code, not anywhere in git
- **Never log secrets** — Relic errors never include secret values
- **Never share master keys** — each developer can have a dev artifact with a dev key
- **Never reuse master keys** — each project and environment should have unique keys

### Key Rotation

To rotate the master key:

```bash
# 1. Decrypt with old key
RELIC_MASTER_KEY=$OLD_KEY npx relic edit
# (Don't make changes, just save and close)

# 2. Note your decrypted secrets

# 3. Delete old artifact and create new with new key
rm config/relic.enc
RELIC_MASTER_KEY=$NEW_KEY npx relic edit
# (Re-enter your secrets)

# 4. Update master key in all deployment environments
```

### Threat Model

Relic protects against:

- ✅ Secrets exposed in git history
- ✅ Secrets leaked in logs/errors
- ✅ Unauthorized access without master key
- ✅ Tampering detection (modified artifacts fail decryption)

Relic does NOT protect against:

- ❌ Master key compromise
- ❌ Memory inspection on running processes
- ❌ Compromised deployment environment

---

## Comparison

| Feature | Relic | dotenv | Rails Credentials | SOPS |
|---------|-------|--------|-------------------|------|
| Encrypted at rest | ✅ | ❌ | ✅ | ✅ |
| Edge runtime support | ✅ | ✅ | ❌ | ❌ |
| Git-friendly diffs | ✅ | ✅ | ❌ | ✅ |
| Single file | ✅ | ❌ | ✅ | ✅ |
| No external dependencies | ✅ | ✅ | ❌ | ❌ |
| Key management | Manual | N/A | Manual | KMS/PGP |
| Edit with $EDITOR | ✅ | ❌ | ✅ | ✅ |

---

## Troubleshooting

### "RELIC_ERR_MISSING_MASTER_KEY"

The master key isn't set. Make sure `RELIC_MASTER_KEY` is in your environment:

```bash
echo $RELIC_MASTER_KEY  # Should print your key
```

### "RELIC_ERR_DECRYPT_FAILED"

Either the master key is wrong, or the artifact was corrupted/tampered with.

```bash
# Verify you're using the correct key
# The key must be EXACTLY the same — including any trailing whitespace

# Check for copy-paste issues
echo -n "$RELIC_MASTER_KEY" | xxd  # Inspect raw bytes
```

### "Editor exits immediately"

Some editors need a flag to wait for the file to be closed:

```bash
export EDITOR="code --wait"     # VS Code
export EDITOR="subl --wait"     # Sublime Text
export EDITOR="atom --wait"     # Atom
```

### "Can't use in browser"

Relic is designed for server-side use only. Secrets should never be sent to the browser.

---

## TypeScript

### Auto-Generated Types

Every time you run `relic edit`, Relic generates a `config/relic.d.ts` file with TypeScript interfaces matching your secrets structure:

```
config/
├── relic.enc         ← Encrypted secrets
├── relic.key         ← Master key (git-ignored)
├── relic.local.json  ← Local overrides (git-ignored)
└── relic.d.ts        ← Auto-generated types (commit this)
```

For this secrets file:

```json
{
  "DATABASE_URL": "postgres://localhost/db",
  "API_KEY": "sk_live_xxx",
  "aws": {
    "ACCESS_KEY": "AKIA...",
    "REGION": "us-east-1"
  },
  "public": {
    "API_URL": "https://api.example.com"
  }
}
```

Relic generates:

```typescript
// config/relic.d.ts (auto-generated)
export interface RelicSecrets {
  DATABASE_URL: string;
  API_KEY: string;
  aws: {
    ACCESS_KEY: string;
    REGION: string;
  };
  public: {
    API_URL: string;
  };
}

export interface RelicPublicSecrets {
  API_URL: string;
}

// Module augmentation — makes load() and loadPublic() return typed results
declare module "@nick-skriabin/relic" {
  interface RelicInstance {
    load(): Promise<RelicSecrets>;
    loadPublic(): Promise<RelicPublicSecrets>;
  }
}
```

Add a reference to the generated file (e.g. in your entry point or a global `.d.ts`):

```typescript
/// <reference path="./config/relic.d.ts" />
```

Now `load()` and `loadPublic()` return typed results automatically — no casting needed:

```typescript
import { createRelic } from "@nick-skriabin/relic";

const relic = createRelic();

const secrets = await relic.load();
secrets.DATABASE_URL;     // string
secrets.aws.ACCESS_KEY;   // string — deep nesting supported
secrets.NONEXISTENT;      // TS error

const pub = await relic.loadPublic();
pub.API_URL;              // string
```

---

## License

MIT © 2025

---

<p align="center">
  <sub>Built with 🔐 for the Edge era</sub>
</p>
