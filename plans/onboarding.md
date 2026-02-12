# Onboarding Experience

Slick `npx create-veryfront` like Qwik's `pnpm create qwik@latest`.

## Goal

Single command → beautiful prompts → app running in 30 seconds.

## Flow

```
npx create-veryfront

┌  Let's create a Veryfront app
│
◇  Project name
│  my-ai-app
│
◇  Template
│  ● AI Chatbot        Agent + chat UI + streaming
│  ○ Chat with Docs    RAG with source citations
│  ○ Multi-Agent       Agents that delegate to each other
│  ○ AI Workflow       Steps + approvals + parallelism
│  ○ Coding Agent      AI code assistant with file tools
│  ○ AI SaaS           Auth + chat + per-user memory
│  ○ Minimal           Blank canvas
│
◇  Install dependencies?
│  Yes (pnpm)
│
◇  Initialize git?
│  Yes
│
●  Creating my-ai-app...
│
◇  ✓ Scaffolded 24 files
◇  ✓ Installed dependencies
◇  ✓ Initialized git
│
├─────────────────────────────────────────╮
│                                         │
│  ✓ Created my-ai-app                    │
│                                         │
│  Next steps:                            │
│    cd my-ai-app                         │
│    pnpm dev                             │
│                                         │
│  Deploy:                                │
│    npx veryfront deploy                 │
│                                         │
├─────────────────────────────────────────╯
│
└  Happy building!
```

## Architecture

**Decoupled entry point - no dependencies:**

```
packages/create-veryfront/
  package.json   # just the bin, zero dependencies
  index.js       # ~20 lines: detect pm, spawn veryfront init
```

```javascript
#!/usr/bin/env node
import { spawn } from 'child_process';

// Detect package manager from npm_config_user_agent
const ua = process.env.npm_config_user_agent || '';
const pm = ua.startsWith('pnpm') ? 'pnpm'
         : ua.startsWith('yarn') ? 'yarn'
         : ua.startsWith('bun')  ? 'bun'
         : 'npx';

// Map to exec command
const exec = { pnpm: 'pnpm', yarn: 'yarn', bun: 'bunx', npx: 'npx' }[pm];

// Spawn veryfront init with user's package manager
spawn(exec, ['veryfront', 'init', ...process.argv.slice(2)], { stdio: 'inherit' });
```

**Why this approach?**
- Zero dependencies = instant install
- Respects user's package manager choice
- All logic stays in `cli/commands/init/` - single codebase
- `create-veryfront` is just a routing layer

## Current State

`veryfront init` already exists with:
- Interactive wizard (template selection)
- Creates project files from template
- Installs dependencies
- Shows next steps

## What Needs Enhancement

1. **Better visual output** - Progress spinners, success box (like Qwik)
2. **Git init** - Currently not done
3. **Project name prompt** - Currently requires `--name` or runs in cwd
4. **Banner** - Simple branding at start

## Auth & Deploy

**No auth for local creation.**

Auth + project creation happens on first deploy:

```
$ npx veryfront deploy
  No account found. Sign in with Google/GitHub/Microsoft?
  Opening browser...
  ✓ Signed in as matt@example.com
  ✓ Created project my-ai-app-x7k2m9
  ✓ Deployed to https://my-ai-app-x7k2m9.veryfront.com
```

The slug is generated at local creation time (e.g., `my-ai-app-x7k2m9`).

## CLI

```bash
npx create-veryfront [name] [options]

-t, --template <name>     chat, rag, multi-agent, workflow, coding-agent, saas, minimal
--no-install              Skip deps
--no-git                  Skip git init
-y, --yes                 Accept all defaults
```

Examples:

```bash
npx create-veryfront                    # interactive
npx create-veryfront my-app -y          # quick, defaults
npx create-veryfront my-app -t rag      # specific template
```

## Package Manager Detection

Detect via `npm_config_user_agent` env var (set by all package managers):

```javascript
// Returns: npm | pnpm | yarn | bun
function detectPackageManager() {
  const ua = process.env.npm_config_user_agent;
  if (!ua) return 'npm'; // fallback
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun'))  return 'bun';
  return 'npm';
}
```

```bash
npm create veryfront   → npm install
pnpm create veryfront  → pnpm install
yarn create veryfront  → yarn install
bun create veryfront   → bun install
```

## Runtime

Veryfront CLI is compiled Deno - users don't need Deno installed.

For user projects, we support Node/Bun runtimes via package.json scripts:

```json
{
  "scripts": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "deploy": "veryfront deploy"
  }
}
```

The `veryfront` binary handles everything. Users just run `pnpm dev`.

## Tasks

1. **Enhance `cli/commands/init/`**
   - Add banner (simple, not massive ASCII)
   - Add project name prompt if not provided
   - Add git init option
   - Improve output with progress spinners
   - Add success box with next steps

2. **Create `packages/create-veryfront/`**
   - package.json with bin, zero dependencies
   - index.js: detect package manager, spawn `veryfront init`
   - ~20 lines total

3. **Publish**
   - Publish `create-veryfront` to npm

## Decisions

- **Banner**: Keep it simple, not massive ASCII art
- **Defaults**: `chat` template, yes to deps, yes to git
- **Auth**: Zero auth until deploy
- **Reuse**: Enhance existing `init` command, don't create new one
