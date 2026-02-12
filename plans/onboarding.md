# Onboarding Experience

Slick `npx create-veryfront` like Qwik's `pnpm create qwik@latest`.

## Goal

Single command → beautiful prompts → app running in 30 seconds.

## Flow

```
npx create-veryfront

┌  Create a Veryfront app
│
◇  Where to create?
│  ● Current folder (.)
│  ○ New folder
│      → Project name: my-app
│
◇  Template
│  ● Minimal            Blank canvas
│  ○ AI Chatbot         Agent + chat UI + streaming
│  ○ Chat with Docs     RAG with source citations
│  ○ Multi-Agent        Agents that delegate
│  ○ AI Workflow        Steps + approvals + parallelism
│  ○ Coding Agent       AI code assistant
│  ○ AI SaaS            Auth + chat + per-user memory
│
◇  Initialize git?
│  Yes
│
◇  Install dependencies?
│  Yes (pnpm)
│
●  Creating project...
│  ✓ Scaffolded files
│  ✓ Initialized git
│  ✓ Installed dependencies
│
├─────────────────────────────────────────╮
│                                         │
│  ✓ Created my-app                       │
│                                         │
│  Next steps:                            │
│    cd my-app                            │
│    pnpm dev                             │
│                                         │
├─────────────────────────────────────────╯
│
└  Happy building!
```

## Design

Use existing TUI styling from `cli/ui/colors.ts`:

- **Brand orange**: `rgb(252, 143, 93)` - active items, prompts
- **Dim orange**: `rgb(180, 100, 65)` - completed items
- **Success green**: `rgb(34, 197, 94)` - checkmarks
- **Dim gray**: muted text, descriptions

Progress indicators:
- `●` brand orange = active
- `○` dim = pending
- `✓` green = done

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

1. **Location prompt** - Current folder vs new folder (then name prompt)
2. **Template order** - Minimal first, then progressively complex
3. **Git init** - Add option + implementation
4. **Progress output** - Spinners with brand colors
5. **Success box** - Clear next steps based on location choice

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

-t, --template <name>     minimal, chat, rag, multi-agent, workflow, coding-agent, saas
--no-install              Skip dependency installation
--no-git                  Skip git initialization
-y, --yes                 Accept all defaults (minimal template, current folder)
```

Examples:

```bash
npx create-veryfront                    # interactive
npx create-veryfront my-app             # new folder, interactive template
npx create-veryfront my-app -y          # quick: new folder, minimal, deps, git
npx create-veryfront -t chat            # current folder, chat template
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

### Code Changes

1. **Update `cli/commands/init/catalog.ts`**
   - Reorder templates: minimal first

2. **Update `cli/commands/init/interactive-wizard.ts`**
   - Add location prompt (current folder / new folder)
   - Add project name prompt if new folder
   - Add git init prompt
   - Remove integrations prompt (keep simple)
   - Use brand colors for prompts

3. **Update `cli/commands/init/init-command.ts`**
   - Add git init after scaffolding
   - Add progress output with spinners
   - Add success box with next steps
   - Next steps should reflect:
     - **Location**: current folder vs new folder (`cd my-app`)
     - **Package manager**: show correct command based on `npm_config_user_agent`
       - pnpm → `pnpm dev`
       - npm → `npm run dev`
       - yarn → `yarn dev`
       - bun → `bun dev`

4. **`create-veryfront` package** (already exists)
   - Separate repo: github.com/veryfront/create-veryfront

### Documentation

5. **Update `cli/commands/init/command-help.ts`**
   - Update template order (minimal first)
   - Remove integrations flag docs
   - Add --no-git flag
   - Update examples to reflect new flow

6. **Update `cli/README.md`**
   - Add `npx create-veryfront` quick start

7. **Create `docs/getting-started.md`** (if needed)
   - Quick start with create-veryfront
   - Template descriptions
   - Next steps after creation

## Decisions

- **Template order**: Minimal first (simple → complex)
- **Defaults**: minimal template, yes to deps, yes to git
- **No integrations**: Keep onboarding simple
- **Auth**: Zero auth until deploy
