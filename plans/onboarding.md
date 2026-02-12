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

**Thin wrapper with veryfront as dependency:**

```
packages/create-veryfront/
  package.json   # bin + depends on "veryfront"
  index.js       # imports and calls veryfront create directly
```

```javascript
// index.js
import { createCommand } from 'veryfront/cli';
createCommand(process.argv.slice(2));
```

All logic lives in `cli/commands/create/`. Single codebase.

**Why not `npx veryfront create`?** Using npx forces npm execution, breaking
package manager detection for pnpm/yarn/bun users. By depending on veryfront
directly, the user's chosen package manager installs everything correctly.

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

```bash
npm create veryfront   → npm install
pnpm create veryfront  → pnpm install
yarn create veryfront  → yarn install
bun create veryfront   → bun install
```

## Tasks

1. Create `cli/commands/create/` command
   - Banner (ASCII or simple)
   - Project name prompt + validation
   - Template select
   - Deps install prompt
   - Git init prompt
   - Progress spinners
   - Success box with next steps

2. Create `packages/create-veryfront/`
   - package.json with bin + veryfront dependency
   - index.js imports and calls veryfront directly

3. Wire up
   - Add `create` to router.ts
   - Publish to npm

## Decisions

- **Banner**: Keep it simple, not massive ASCII art
- **Defaults**: `chat` template, yes to deps, yes to git
- **Auth**: Zero auth until deploy
