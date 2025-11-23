---
title: "CLI Reference"
category: "reference"
level: "reference"
keywords: ["cli", "commands", "dev", "build", "start", "init", "command-line"]
ai_summary: "Complete command-line interface reference for all Veryfront CLI commands including options, flags, and usage examples"
related: ["reference/configuration", "getting-started/installation", "quick-start"]
version: "0.1.0"
last_updated: "2025-11-22"
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
| `--template` | `-t` | string | minimal | Project template to use |
| `--runtime` | `-r` | string | auto | Target runtime: `deno`, `node`, `bun` |
| `--router` | | string | app | Router type: `app`, `pages` |
| `--ai` | | boolean | false | Enable AI features |
| `--git` | | boolean | true | Initialize git repository |
| `--install` | | boolean | true | Install dependencies automatically |
| `--force` | `-f` | boolean | false | Override existing files |

### Templates

Available templates:

- `minimal` - Minimal App Router setup
- `minimal-pages` - Minimal Pages Router setup
- `blog` - Blog with MDX support
- `saas` - SaaS starter with authentication
- `ai-app` - Full-stack app with AI integration
- `dashboard` - Admin dashboard template

### Examples

```bash
# Initialize in current directory
veryfront init

# Create new project
veryfront init my-app

# Use specific template
veryfront init my-blog --template blog

# Initialize for specific runtime
veryfront init my-app --runtime deno

# Pages Router instead of App Router
veryfront init my-app --router pages

# Enable AI features
veryfront init my-app --ai

# Skip git and npm install
veryfront init my-app --git=false --install=false

# Force overwrite existing files
veryfront init existing-project --force
```

### Behavior

**Initialization Process:**
1. Creates project directory (if specified)
2. Copies template files
3. Generates `veryfront.config.ts`
4. Creates appropriate runtime config (`deno.json`, `package.json`, etc.)
5. Initializes git repository (unless `--git=false`)
6. Installs dependencies (unless `--install=false`)
7. Displays next steps

**Generated Files:**

**Minimal template:**
```
my-app/
├── app/
│   ├── layout.tsx
│   └── page.tsx
├── public/
│   └── favicon.ico
├── veryfront.config.ts
├── tsconfig.json or deno.json
└── package.json or deno.json
```

**With AI:**
```
my-app/
├── app/
├── ai/
│   ├── tools/
│   │   └── example.ts
│   └── agents/
│       └── assistant.ts
├── public/
├── veryfront.config.ts
└── ...
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
- [Installation Guide](../../getting-started/installation.md) - Setup instructions
- [Deployment Guides](../../guides/deployment/README.md) - Production deployment
- [Quick Start](../../quick-start.md) - Get started in 5 minutes
- [Troubleshooting](../../guides/troubleshooting.md) - Common issues and solutions

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
