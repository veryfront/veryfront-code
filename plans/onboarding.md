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

**Thin wrapper calling `veryfront init`:**

```
packages/create-veryfront/
  package.json   # bin + depends on "veryfront"
  index.js       # imports and calls veryfront init
```

```javascript
// index.js
import { initCommand } from 'veryfront/cli';
initCommand(process.argv.slice(2));
```

**Why not `npx veryfront init`?** Using npx forces npm execution, breaking
package manager detection for pnpm/yarn/bun users. By depending on veryfront
directly, the user's chosen package manager installs everything correctly.

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
   - package.json with bin + veryfront dependency
   - index.js imports and calls `initCommand` directly

3. **Publish**
   - Publish `create-veryfront` to npm

## Decisions

- **Banner**: Keep it simple, not massive ASCII art
- **Defaults**: `chat` template, yes to deps, yes to git
- **Auth**: Zero auth until deploy
- **Reuse**: Enhance existing `init` command, don't create new one
