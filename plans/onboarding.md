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
◇  Add integrations? (space to select)
│  ◻ Gmail   ◻ Slack   ◻ Notion   ◻ GitHub
│  ◻ Calendar ◻ Drive  ◻ Jira     ◻ Linear
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
│    echo "OPENAI_API_KEY=sk-..." >> .env │
│    veryfront dev                        │
│                                         │
│  Deploy:                                │
│    veryfront deploy                     │
│                                         │
├─────────────────────────────────────────╯
│
└  Happy building!
```

## Architecture

**Thin wrapper approach:**

```
packages/create-veryfront/
  package.json   # bin → npx veryfront create
  index.js       # 5 lines: spawns veryfront create
```

All logic in `cli/commands/create/`. Single codebase.

## Auth

**No auth for local creation.**

Auth only when deploying:

```
$ veryfront deploy
  No account found. Sign in with Google/GitHub/Microsoft?
  Opening browser...
  ✓ Signed in
  ✓ Deployed
```

## CLI

```bash
npx create-veryfront [name] [options]

-t, --template <name>     chat, rag, multi-agent, workflow, coding-agent, saas, minimal
-i, --integrations <list> gmail,slack,github
--no-install              Skip deps
--no-git                  Skip git init
-y, --yes                 Accept all defaults
```

Examples:

```bash
npx create-veryfront                           # interactive
npx create-veryfront my-app -y                 # quick, defaults
npx create-veryfront my-app -t rag -i github   # specific
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
   - Integration multi-select (popular 8)
   - Deps install prompt
   - Git init prompt
   - Progress spinners
   - Success box with next steps

2. Create `packages/create-veryfront/`
   - package.json with bin
   - index.js spawns `npx veryfront create`

3. Wire up
   - Add `create` to router.ts
   - Publish to npm

## Decisions

- **Banner**: Keep it simple, not massive ASCII art
- **Integrations**: Show popular 8, not all 50+
- **Defaults**: `chat` template, no integrations, yes to deps, yes to git
- **Auth**: Zero auth until deploy
