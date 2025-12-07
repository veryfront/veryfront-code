---
title: "CLI Reference"
category: "reference"
level: "reference"
keywords: ["cli", "commands", "dev", "build", "start", "init", "command-line", "config", "scaffolding", "ci-cd"]
ai_summary: "Complete command-line interface reference for all Veryfront CLI commands including options, flags, usage examples, and JSON config file scaffolding for CI/CD automation"
related: ["reference/configuration", "getting-started/installation", "quick-start", "reference/ai/integrations"]
version: "0.1.0"
last_updated: "2025-12-07"
---

# CLI Reference

Complete reference for all Veryfront command-line interface (CLI) commands.

## Overview

The Veryfront CLI provides commands for developing, building, and deploying your applications across all supported runtimes (Deno, Node.js, Bun, Cloudflare Workers).

### Installation

The CLI is automatically available after installing Veryfront:

```bash
# Deno
deno add @veryfront/core

# Node.js
npm install veryfront

# Bun
bun add veryfront
```

### Usage

```bash
# General syntax
veryfront <command> [options]

# Get help
veryfront --help
veryfront <command> --help
```

---

## Global Options

Options available for all commands:

| Option | Alias | Type | Description |
|--------|-------|------|-------------|
| `--help` | `-h` | boolean | Show help information |
| `--version` | `-v` | boolean | Show version number |
| `--config` | `-c` | string | Path to config file (default: `veryfront.config.ts`) |
| `--verbose` | | boolean | Enable verbose logging |
| `--quiet` | `-q` | boolean | Suppress output except errors |

### Examples

```bash
# Show version
veryfront --version
veryfront -v

# Use custom config
veryfront dev --config ./custom.config.ts

# Verbose logging
veryfront build --verbose
```

---

## veryfront dev

Start the development server with hot module replacement (HMR).

### Usage

```bash
veryfront dev [options]
```

### Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--port` | `-p` | number | 3000 | Port number to listen on |
| `--host` | `-h` | string | localhost | Host to bind to (use 0.0.0.0 for network access) |
| `--open` | `-o` | boolean | false | Open browser automatically |
| `--mcp` | | boolean | false | Enable MCP (Model Context Protocol) server |
| `--mcp-port` | | number | 3001 | Port for MCP server |
| `--https` | | boolean | false | Enable HTTPS with self-signed certificate |
| `--cert` | | string | | Path to SSL certificate file |
| `--key` | | string | | Path to SSL key file |

### Examples

```bash
# Start dev server on default port (3000)
veryfront dev

# Start on custom port
veryfront dev --port 8080
veryfront dev -p 8080

# Bind to all network interfaces
veryfront dev --host 0.0.0.0

# Open browser automatically
veryfront dev --open
veryfront dev -o

# Enable MCP server for AI tools
veryfront dev --mcp

# MCP server on custom port
veryfront dev --mcp --mcp-port 4000

# Enable HTTPS with self-signed cert
veryfront dev --https

# Use custom SSL certificate
veryfront dev --https --cert ./cert.pem --key ./key.pem
```

### Behavior

**Development Mode Features:**
- Hot Module Replacement (HMR) - Changes reflect instantly without full reload
- Fast Refresh - Preserves component state during updates
- Source maps - Enabled by default for debugging
- Memory serving - Assets served from memory, not disk
- Error overlay - Shows errors in the browser
- File watching - Monitors all project files for changes

**What it watches:**
- `app/**/*` or `pages/**/*` - Route files
- `veryfront.config.ts` - Configuration (requires restart)
- `public/**/*` - Static assets
- `ai/**/*` - AI tools and agents (when AI enabled)

**Environment:**
- Sets `NODE_ENV=development`
- Enables React strict mode
- Includes development warnings
- Unoptimized bundles for faster rebuilds

### Runtime-Specific Notes

**Deno:**
```bash
deno task dev
# Equivalent to: deno run --allow-all --watch veryfront dev
```

**Node.js:**
```bash
npm run dev
# Uses nodemon or similar for file watching
```

**Bun:**
```bash
bun run dev
# Native watch mode with fast HMR
```

---

## veryfront build

Build your application for production deployment.

### Usage

```bash
veryfront build [options]
```

### Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--outDir` | `-o` | string | .veryfront | Output directory for build artifacts |
| `--sourcemap` | | boolean | false | Generate source maps for production |
| `--minify` | | boolean | true | Minify JavaScript and CSS |
| `--analyze` | | boolean | false | Analyze bundle size and composition |
| `--target` | `-t` | string | auto | Build target: `deno`, `node`, `bun`, `cloudflare` |
| `--mode` | `-m` | string | production | Build mode: `production`, `staging` |
| `--clean` | | boolean | true | Clean output directory before build |
| `--experimental-edge` | | boolean | false | Enable experimental edge runtime features |

### Examples

```bash
# Standard production build
veryfront build

# Build with source maps
veryfront build --sourcemap

# Analyze bundle size
veryfront build --analyze

# Build for specific target
veryfront build --target cloudflare

# Build without minification (debugging)
veryfront build --minify=false

# Custom output directory
veryfront build --outDir ./dist

# Staging build
veryfront build --mode staging

# Keep previous build
veryfront build --clean=false
```

### Behavior

**Build Process:**
1. Cleans output directory (unless `--clean=false`)
2. Validates configuration and dependencies
3. Compiles TypeScript and JSX
4. Bundles JavaScript with code splitting
5. Processes CSS and assets
6. Generates static pages (SSG/ISR)
7. Optimizes images and fonts
8. Creates server bundle for SSR
9. Generates manifests and metadata

**Optimizations:**
- Dead code elimination (tree shaking)
- Minification and compression
- Code splitting by route
- Asset optimization (images, fonts)
- CSS purging for unused styles
- Inline critical CSS
- Preload hints for resources

**Output Structure:**
```
.veryfront/
├── client/           # Client-side bundles
│   ├── chunks/       # Code-split chunks
│   ├── assets/       # Processed assets
│   └── manifest.json # Asset manifest
├── server/           # Server bundles
│   └── index.js      # Server entry
├── static/           # Pre-rendered pages (SSG)
└── public/           # Static assets (copied from /public)
```

**Environment:**
- Sets `NODE_ENV=production`
- Disables React strict mode
- Removes development warnings
- Optimized bundles for performance

### Runtime-Specific Builds

**Deno:**
```bash
deno task build
# Outputs: ES modules with Deno runtime imports
```

**Node.js:**
```bash
npm run build
# Outputs: CommonJS or ES modules based on package.json
```

**Bun:**
```bash
bun run build
# Outputs: Optimized bundles with Bun-specific APIs
```

**Cloudflare Workers:**
```bash
veryfront build --target cloudflare
# Outputs: Worker-compatible bundle with limited Node.js APIs
```

---

## veryfront start

Start the production server with the built application.

### Usage

```bash
veryfront start [options]
```

### Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--port` | `-p` | number | 3000 | Port number to listen on |
| `--host` | `-h` | string | localhost | Host to bind to |
| `--dir` | `-d` | string | .veryfront | Directory containing build output |
| `--workers` | `-w` | number | auto | Number of worker processes (Node.js only) |

### Examples

```bash
# Start production server
veryfront start

# Start on custom port
veryfront start --port 8080
veryfront start -p 8080

# Bind to all interfaces
veryfront start --host 0.0.0.0

# Use custom build directory
veryfront start --dir ./dist

# Start with multiple workers (Node.js)
veryfront start --workers 4
```

### Behavior

**Production Mode Features:**
- Serves pre-built optimized bundles
- No HMR or file watching
- Compressed response bodies (gzip/brotli)
- Production error handling (no stack traces exposed)
- Optimized caching headers
- Clustered mode support (Node.js)

**What it serves:**
- Pre-rendered static pages (SSG)
- Server-rendered pages on demand (SSR)
- API routes
- Static assets from `/public`
- Client JavaScript bundles

**Environment:**
- Uses `NODE_ENV=production`
- Disables debug logging
- Optimized for throughput and latency
- Memory-efficient serving

**Prerequisites:**
- Must run `veryfront build` first
- Build directory must exist (default: `.veryfront`)

### Runtime-Specific Start

**Deno:**
```bash
deno task start
# Runs: deno run --allow-net --allow-read --allow-env .veryfront/server/index.js
```

**Node.js:**
```bash
npm start
# Can use cluster mode for multi-core performance
```

**Bun:**
```bash
bun start
# Native HTTP server with excellent performance
```

**Cloudflare Workers:**
```bash
wrangler deploy
# Deploys to Cloudflare's edge network (no local start)
```

---

## veryfront init

Initialize a new Veryfront project or add Veryfront to an existing project.

### Usage

```bash
veryfront init [directory] [options]
```

### Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `directory` | string | Project directory (default: current directory) |

### Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--template` | `-t` | string | ai | Project template to use |
| `--integrations` | | string | | Comma-separated service integrations (e.g., `gmail,slack,github`) |
| `--config` | `-c` | string | | Path to JSON config file for programmatic scaffolding |
| `--skip-install` | | boolean | false | Skip automatic dependency installation |
| `--skip-env-prompt` | | boolean | false | Skip environment variable prompts |
| `--runtime` | `-r` | string | auto | Target runtime: `deno`, `node`, `bun` |
| `--force` | `-f` | boolean | false | Override existing files |

### Templates

Available templates:

- `ai` - AI Agent with service integrations (default)
- `app` - Full app with auth and dashboard
- `blog` - Blog with MDX support
- `docs` - Documentation site
- `minimal` - Simple starting point

### Examples

```bash
# Interactive wizard (recommended for first-time users)
veryfront init

# Create new AI agent project
veryfront init my-agent

# AI agent with specific integrations
veryfront init my-agent --template ai --integrations gmail,slack,github

# Create a blog
veryfront init my-blog --template blog

# Create documentation site
veryfront init my-docs --template docs

# Programmatic scaffolding from config file
veryfront init --config project.json

# Skip all prompts (for CI/CD)
veryfront init my-app --config project.json --skip-install --skip-env-prompt
```

### Behavior

**Initialization Process:**
1. Runs interactive wizard (if no template specified)
2. Creates project directory (if specified)
3. Copies template files
4. Loads and merges integration files (for AI template)
5. Prompts for environment variables (unless skipped)
6. Generates `package.json` and config files
7. Installs dependencies (unless `--skip-install`)
8. Displays next steps

**Generated Files:**

**AI template with integrations:**
```
my-agent/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── api/
│   │   ├── chat/route.ts
│   │   └── auth/[service]/route.ts
│   └── setup/page.tsx
├── ai/
│   ├── agents/assistant.ts
│   └── tools/
├── lib/
│   └── token-store.ts
├── .env
├── .env.example
├── veryfront.config.ts
└── package.json
```

---

## Config File Scaffolding

For CI/CD pipelines and automation, use a JSON config file to scaffold projects programmatically.

### Config File Format

Create a `project.json` file:

```json
{
  "name": "my-ai-agent",
  "template": "ai",
  "integrations": ["gmail", "slack", "github", "calendar"],
  "skipInstall": false,
  "skipEnvPrompt": true,
  "env": {
    "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "your-google-secret",
    "SLACK_CLIENT_ID": "123456789.987654321",
    "SLACK_CLIENT_SECRET": "your-slack-secret",
    "GITHUB_CLIENT_ID": "Iv1.abc123def456",
    "GITHUB_CLIENT_SECRET": "your-github-secret",
    "OPENAI_API_KEY": "sk-..."
  }
}
```

### Config Properties

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `name` | string | No | Project directory name |
| `template` | string | No | Template: `ai`, `app`, `blog`, `docs`, `minimal` |
| `integrations` | string[] | No | Service integrations to include |
| `skipInstall` | boolean | No | Skip dependency installation |
| `skipEnvPrompt` | boolean | No | Skip interactive env prompts |
| `env` | object | No | Pre-filled environment variable values |

### Usage

```bash
# Scaffold from config file
veryfront init --config project.json

# Override config with CLI flags
veryfront init my-custom-name --config project.json --template app

# Fully automated (no prompts)
veryfront init --config project.json --skip-env-prompt
```

### Environment Variables by Integration

Each integration requires specific credentials. Use the `env` object to pre-fill them:

**Google Services** (Gmail, Calendar, Drive, Sheets, Docs):
```json
{
  "env": {
    "GOOGLE_CLIENT_ID": "your-id.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "your-secret"
  }
}
```

**Microsoft Services** (Outlook, Teams, OneDrive, SharePoint):
```json
{
  "env": {
    "MICROSOFT_CLIENT_ID": "your-azure-app-id",
    "MICROSOFT_CLIENT_SECRET": "your-secret"
  }
}
```

**Atlassian** (Jira, Confluence):
```json
{
  "env": {
    "ATLASSIAN_CLIENT_ID": "your-client-id",
    "ATLASSIAN_CLIENT_SECRET": "your-secret"
  }
}
```

**Slack**:
```json
{
  "env": {
    "SLACK_CLIENT_ID": "123456789.987654321",
    "SLACK_CLIENT_SECRET": "your-secret"
  }
}
```

**GitHub**:
```json
{
  "env": {
    "GITHUB_CLIENT_ID": "Iv1.abc123",
    "GITHUB_CLIENT_SECRET": "your-secret"
  }
}
```

**AI Providers**:
```json
{
  "env": {
    "OPENAI_API_KEY": "sk-...",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```

### CI/CD Example

**GitHub Actions:**
```yaml
name: Scaffold Project

on:
  workflow_dispatch:
    inputs:
      project_name:
        description: 'Project name'
        required: true

jobs:
  scaffold:
    runs-on: ubuntu-latest
    steps:
      - name: Create config file
        run: |
          cat > project.json << 'EOF'
          {
            "name": "${{ github.event.inputs.project_name }}",
            "template": "ai",
            "integrations": ["gmail", "slack", "github"],
            "skipInstall": true,
            "skipEnvPrompt": true,
            "env": {
              "GOOGLE_CLIENT_ID": "${{ secrets.GOOGLE_CLIENT_ID }}",
              "GOOGLE_CLIENT_SECRET": "${{ secrets.GOOGLE_CLIENT_SECRET }}",
              "SLACK_CLIENT_ID": "${{ secrets.SLACK_CLIENT_ID }}",
              "SLACK_CLIENT_SECRET": "${{ secrets.SLACK_CLIENT_SECRET }}",
              "GITHUB_CLIENT_ID": "${{ secrets.GH_OAUTH_CLIENT_ID }}",
              "GITHUB_CLIENT_SECRET": "${{ secrets.GH_OAUTH_CLIENT_SECRET }}"
            }
          }
          EOF

      - name: Install Veryfront
        run: npm install -g veryfront

      - name: Scaffold project
        run: veryfront init --config project.json

      - name: Install dependencies
        run: cd ${{ github.event.inputs.project_name }} && npm install
```

### Complete Config Example

Here's a full example with all 50+ integrations configured:

```json
{
  "name": "enterprise-ai-agent",
  "template": "ai",
  "integrations": [
    "gmail", "calendar", "drive", "sheets",
    "outlook", "teams", "onedrive",
    "slack", "discord",
    "github", "gitlab", "jira", "confluence",
    "notion", "linear", "asana",
    "salesforce", "hubspot",
    "stripe", "zendesk"
  ],
  "skipInstall": false,
  "skipEnvPrompt": true,
  "env": {
    "OPENAI_API_KEY": "sk-...",
    "GOOGLE_CLIENT_ID": "...",
    "GOOGLE_CLIENT_SECRET": "...",
    "MICROSOFT_CLIENT_ID": "...",
    "MICROSOFT_CLIENT_SECRET": "...",
    "SLACK_CLIENT_ID": "...",
    "SLACK_CLIENT_SECRET": "...",
    "GITHUB_CLIENT_ID": "...",
    "GITHUB_CLIENT_SECRET": "...",
    "ATLASSIAN_CLIENT_ID": "...",
    "ATLASSIAN_CLIENT_SECRET": "...",
    "NOTION_API_KEY": "...",
    "LINEAR_CLIENT_ID": "...",
    "LINEAR_CLIENT_SECRET": "...",
    "SALESFORCE_CLIENT_ID": "...",
    "SALESFORCE_CLIENT_SECRET": "...",
    "HUBSPOT_CLIENT_ID": "...",
    "HUBSPOT_CLIENT_SECRET": "...",
    "STRIPE_SECRET_KEY": "...",
    "ZENDESK_CLIENT_ID": "...",
    "ZENDESK_CLIENT_SECRET": "..."
  }
}
```

---

## Token Storage & Security

When using OAuth integrations, tokens (access tokens, refresh tokens) must be stored securely. Veryfront provides a flexible token storage system with encryption support.

### Storage Modes

| Mode | Environment Variable | Best For |
|------|---------------------|----------|
| In-Memory | (default) | Development only |
| PostgreSQL | `DATABASE_URL` | Production apps |
| Vercel KV | `KV_REST_API_URL` | Vercel deployments |
| Redis | `REDIS_URL` | High-performance needs |
| SQLite/D1 | Custom | Edge/serverless |

### Quick Setup

**Development (default):**
No configuration needed. Tokens are stored in memory and lost on restart.

**Production with Vercel KV:**
```bash
# .env
KV_REST_API_URL=https://your-kv.vercel-storage.com
KV_REST_API_TOKEN=your-token
TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key
```

**Production with PostgreSQL:**
```bash
# .env
DATABASE_URL=postgres://user:pass@host:5432/db
TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key
```

Generate an encryption key:
```bash
openssl rand -hex 32
```

### Token Store Implementation

The default `lib/token-store.ts` provides:

```typescript
import { tokenStore, createTokenStore, getStorageMode } from './token-store';

// Check current mode
console.log(getStorageMode()); // "memory" | "database" | "kv" | "redis"

// Use default store
const token = await tokenStore.getToken(userId, 'gmail');

// Create custom store
const customStore = createTokenStore({
  get: (key) => myDb.get(key),
  set: (key, value) => myDb.set(key, value),
  delete: (key) => myDb.delete(key),
});
```

### Production Examples

See `lib/token-store-examples.ts` for copy-paste implementations:

```typescript
// Vercel KV
import { createVercelKVStore } from './token-store-examples';
export const tokenStore = createVercelKVStore();

// PostgreSQL
import { createPostgresStore } from './token-store-examples';
export const tokenStore = createPostgresStore();

// Redis
import { createRedisStore } from './token-store-examples';
export const tokenStore = createRedisStore();

// Auto-select based on environment
import { createAutoStore } from './token-store-examples';
export const tokenStore = createAutoStore();
```

### Database Schema

**PostgreSQL:**
```sql
CREATE TABLE oauth_tokens (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_oauth_tokens_key ON oauth_tokens(key);
```

**SQLite:**
```sql
CREATE TABLE oauth_tokens (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

**Prisma:**
```prisma
model OAuthToken {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

### Security Best Practices

1. **Always encrypt tokens in production**
   - Set `TOKEN_ENCRYPTION_KEY` environment variable
   - Uses AES-256-GCM encryption
   - Key should be 32 bytes (64 hex characters)

2. **Use HTTPS everywhere**
   - OAuth callbacks must use HTTPS
   - All API routes should use HTTPS in production

3. **Rotate encryption keys**
   - Periodically generate new keys
   - Re-encrypt existing tokens during rotation

4. **Secure environment variables**
   - Never commit `.env` files
   - Use secrets management (Vercel, GitHub Secrets, etc.)
   - Restrict access to production credentials

5. **Token lifecycle**
   - Tokens auto-refresh when expired (if refresh token available)
   - Implement token revocation for user logout
   - Clean up stale tokens periodically

### Encryption Details

Tokens are encrypted using AES-256-GCM:

```typescript
import { encryptToken, decryptToken } from './token-store';

// Encrypt (automatic if TOKEN_ENCRYPTION_KEY is set)
const encrypted = await encryptToken(token);
// Returns: "encrypted:base64..." or plain JSON if no key

// Decrypt
const token = await decryptToken(encrypted);
```

### Troubleshooting

**Tokens lost after restart:**
- You're using in-memory storage (development mode)
- Set `DATABASE_URL`, `KV_REST_API_URL`, or `REDIS_URL`

**Cannot decrypt tokens:**
- `TOKEN_ENCRYPTION_KEY` not set or changed
- Key must be exactly 64 hex characters

**Storage mode not detected:**
- Check environment variable names (case-sensitive)
- Verify credentials are valid

**Check current mode:**
```typescript
import { getStorageMode, isEncryptionEnabled } from './token-store';

console.log('Storage:', getStorageMode());
console.log('Encrypted:', isEncryptionEnabled());
```

---

## veryfront upgrade

Upgrade Veryfront to the latest version.

### Usage

```bash
veryfront upgrade [options]
```

### Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--version` | `-v` | string | latest | Specific version to upgrade to |
| `--force` | `-f` | boolean | false | Force upgrade even if already latest |
| `--check` | | boolean | false | Check for updates without upgrading |

### Examples

```bash
# Upgrade to latest version
veryfront upgrade

# Upgrade to specific version
veryfront upgrade --version 0.2.0

# Check for updates
veryfront upgrade --check

# Force reinstall
veryfront upgrade --force
```

---

## veryfront doctor

Diagnose common issues with your Veryfront installation and project.

### Usage

```bash
veryfront doctor [options]
```

### Options

| Option | Alias | Type | Description |
|--------|-------|------|-------------|
| `--fix` | | boolean | Automatically fix issues when possible |
| `--verbose` | `-v` | boolean | Show detailed diagnostic information |

### Examples

```bash
# Run diagnostics
veryfront doctor

# Auto-fix issues
veryfront doctor --fix

# Verbose output
veryfront doctor --verbose
```

### Checks

The doctor command checks:
- Veryfront installation and version
- Runtime version (Deno/Node/Bun)
- Configuration file validity
- Required dependencies
- File structure and conventions
- TypeScript/Deno configuration
- Port availability
- Build output integrity
- Common misconfigurations

---

## Environment Variables

Configure CLI behavior with environment variables:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `VERYFRONT_PORT` | number | 3000 | Default dev server port |
| `VERYFRONT_HOST` | string | localhost | Default host |
| `VERYFRONT_CONFIG` | string | veryfront.config.ts | Config file path |
| `NODE_ENV` | string | | Environment mode |
| `VERYFRONT_CACHE_DIR` | string | .veryfront/cache | Cache directory |
| `VERYFRONT_LOG_LEVEL` | string | info | Log level: `debug`, `info`, `warn`, `error` |

### Examples

```bash
# Custom port via environment variable
VERYFRONT_PORT=8080 veryfront dev

# Debug logging
VERYFRONT_LOG_LEVEL=debug veryfront build

# Custom config location
VERYFRONT_CONFIG=./config/custom.ts veryfront dev
```

---

## Exit Codes

The CLI uses standard exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic error |
| 2 | Invalid usage (wrong arguments/options) |
| 3 | Configuration error |
| 4 | Build error |
| 5 | Runtime error |
| 130 | Terminated by user (Ctrl+C) |

---

## Configuration File

All commands read from `veryfront.config.ts` by default. You can specify a custom config file:

```bash
veryfront dev --config ./custom.config.ts
```

See [Configuration Reference](../configuration/README.md) for complete configuration options.

---

## Runtime-Specific Commands

### Deno

Recommended `deno.json` tasks:

```json
{
  "tasks": {
    "dev": "deno run --allow-all --watch veryfront dev",
    "build": "deno run --allow-all veryfront build",
    "start": "deno run --allow-net --allow-read --allow-env .veryfront/server/index.js",
    "preview": "deno run --allow-all veryfront start"
  }
}
```

### Node.js

Recommended `package.json` scripts:

```json
{
  "scripts": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "start": "veryfront start",
    "preview": "veryfront start",
    "lint": "eslint .",
    "type-check": "tsc --noEmit"
  }
}
```

### Bun

Recommended `package.json` scripts:

```json
{
  "scripts": {
    "dev": "bun run veryfront dev",
    "build": "bun run veryfront build",
    "start": "bun run veryfront start",
    "preview": "bun run veryfront start"
  }
}
```

---

## Debugging

### Enable Debug Logging

```bash
# Verbose output
veryfront dev --verbose

# Debug environment variable
DEBUG=veryfront:* veryfront dev

# Log level
VERYFRONT_LOG_LEVEL=debug veryfront build
```

### Inspect Build Output

```bash
# Analyze bundle
veryfront build --analyze

# Keep unminified
veryfront build --minify=false

# Generate source maps
veryfront build --sourcemap
```

### Profile Performance

```bash
# Node.js profiling
node --prof node_modules/.bin/veryfront build

# Deno profiling
deno run --allow-all --inspect veryfront dev
```

---

## Continuous Integration

### GitHub Actions

```yaml
name: Build and Test

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x
      - run: deno task build
```

### GitLab CI

```yaml
build:
  image: denoland/deno:latest
  script:
    - deno task build
  artifacts:
    paths:
      - .veryfront/
```

---

## See Also

- [Configuration Reference](../configuration/README.md) - Complete config options
- [Installation Guide](/learn/installation.md) - Setup instructions
- [Deployment Guides](../../guides/deployment/README.md) - Production deployment
- [Quick Start](/learn/quickstart.md) - Get started in 5 minutes
- [Troubleshooting](/guides/troubleshooting/README.md) - Common issues and solutions

---

## Quick Reference

### Common Commands

```bash
# Development
veryfront dev                    # Start dev server
veryfront dev -p 8080           # Custom port
veryfront dev --open            # Open browser
veryfront dev --mcp             # Enable MCP server

# Building
veryfront build                 # Production build
veryfront build --analyze       # Analyze bundle
veryfront build --sourcemap     # With source maps

# Production
veryfront start                 # Start production server
veryfront start -p 8080        # Custom port

# Setup
veryfront init                  # Initialize project
veryfront init my-app          # New project
veryfront init --template blog  # With template

# Maintenance
veryfront upgrade              # Upgrade Veryfront
veryfront doctor               # Check installation
veryfront --version            # Show version
veryfront --help               # Show help
```

### Command Chaining

```bash
# Build and start
veryfront build && veryfront start

# Clean build
rm -rf .veryfront && veryfront build

# Production simulation
veryfront build && VERYFRONT_PORT=8080 veryfront start
```
