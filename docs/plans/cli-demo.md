# Plan: Veryfront CLI Demo Flow for Pro Coders

## Goal

Create a lightning-fast, single-command experience for stage demos that takes a pro coder from zero to deployed in seconds.

**Command**: `deno task cli new my-app` (dev) → `veryfront new my-app` (production)

---

## Demo Flow (Stage Presentation)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VERYFRONT DEMO FLOW                               │
│                                                                             │
│  Pro Coder                    CLI                           Output          │
│  ─────────                    ───                           ──────          │
│                                                                             │
│     ┌─────────────┐                                                         │
│     │   Intent    │                                                         │
│     │  "I want    │                                                         │
│     │  an AI app" │                                                         │
│     └──────┬──────┘                                                         │
│            │                                                                │
│            ▼                                                                │
│  ┌─────────────────────┐     ┌──────────────┐                               │
│  │ $ veryfront new     │────▶│ Check Auth   │                               │
│  │   my-agent          │     │   (cached)   │                               │
│  └─────────────────────┘     └──────┬───────┘                               │
│            │                        │                                       │
│            │                        ▼                                       │
│            │                 ┌──────────────┐      ┌───────────────────┐    │
│            │                 │ Reserve Slug │─────▶│  my-agent         │    │
│            │                 │   (async)    │      │  .veryfront.app   │    │
│            │                 └──────────────┘      └───────────────────┘    │
│            │                        │                       │               │
│            │                        ▼                       ▼               │
│            │                 ┌──────────────┐      ┌───────────────────┐    │
│            │                 │  Scaffold    │      │ URLs displayed    │    │
│            │                 │  AI template │      │ immediately       │    │
│            │                 │  (12 files)  │      └───────────────────┘    │
│            │                 └──────┬───────┘                               │
│            │                        │                                       │
│            │                        ▼                                       │
│            │                 ┌──────────────┐      ┌───────────────────┐    │
│            │                 │ Dev Server   │─────▶│ http://localhost  │    │
│            │                 │   Ready      │      │ :3000             │    │
│            │                 └──────┬───────┘      └───────────────────┘    │
│            │                        │                                       │
│            ▼                        ▼                                       │
│     ┌─────────────┐          ┌──────────────┐                               │
│     │  [ENTER]    │─────────▶│   Deploy     │                               │
│     │  keypress   │          │  to Cloud    │                               │
│     └─────────────┘          └──────┬───────┘                               │
│                                     │                                       │
│                                     ▼                                       │
│                              ┌──────────────┐      ┌───────────────────┐    │
│                              │    LIVE!     │─────▶│ https://my-agent  │    │
│                              │              │      │ .veryfront.app    │    │
│                              └──────────────┘      └───────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Timeline (Target: Under 5 Seconds)

```
Time     Action                              Audience Sees
────     ──────                              ─────────────
0.0s     Command entered                     $ veryfront new my-agent
0.1s     Auth check (cached)                 Logged in as kent@veryfront.com
0.2s     URLs shown (optimistic)             Local: http://...  Live: https://...
0.5s     Files scaffolded                    (no output, fast)
1.0s     Dev server ready                    "Ready! Press Enter to deploy"
         [User presses Enter]
1.5s     Push to remote                      "Deploying..."
3.0s     Release created
3.5s     Deployed                            "Done! https://my-agent.veryfront.app"
```

### Demo Script (What to Say on Stage)

1. **"One command"** - Type `veryfront new my-agent`
2. **"Instant auth"** - Point to "Logged in as..."
3. **"URLs ready"** - Point to Local and Live URLs
4. **"Live preview"** - Open browser to localhost (optional)
5. **"One keypress to deploy"** - Press Enter
6. **"Done"** - Show live URL in browser

---

## Terminal Output (Stage Experience)

```
$ deno task cli new my-agent

  ⚡ Veryfront

  kent@veryfront.com

  Creating my-agent...

  Local   http://my-agent.lvh.me:3000
  Live    https://my-agent.veryfront.app

  ✓ Ready

  Press Enter to deploy, Ctrl+C to exit

[User presses Enter]

  Deploying...

  ✓ Done!

  https://my-agent.veryfront.app

```

**Total time: ~3-5 seconds from command to deployed URL**

---

## Why This Beats Create React App

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CREATE REACT APP vs VERYFRONT                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CREATE REACT APP                    VERYFRONT                          │
│  ────────────────                    ─────────                          │
│                                                                         │
│  $ npx create-react-app my-app       $ veryfront new my-agent           │
│    ████████████████ 45 seconds         ▓ 0.5 seconds                    │
│    (npm install...)                    (no install needed!)             │
│                                                                         │
│  $ cd my-app                         (auto - already in directory)      │
│                                                                         │
│  $ npm start                         (auto - server starts)             │
│    ████████ 8 seconds                                                   │
│                                                                         │
│  (manually open browser)             (auto - browser opens)             │
│                                                                         │
│  (figure out deployment...)          Press Enter                        │
│  $ npm run build                       ▓ 2 seconds                      │
│  $ vercel deploy                                                        │
│    ████████████ 30 seconds           ✓ Live at my-agent.veryfront.app   │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────────  │
│  TOTAL: ~90 seconds + manual work    TOTAL: ~5 seconds + Enter          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Differentiators

| Pain Point | CRA | Veryfront |
|------------|-----|-----------|
| npm install | 30-60 seconds | **0 seconds** (Deno URL imports) |
| Commands needed | 3 (`npx`, `cd`, `npm start`) | **1** (`veryfront new`) |
| Browser open | Manual or delayed | **Instant auto-open** |
| Deployment | Separate tool (Vercel, Netlify) | **Built-in** (Enter key) |
| Live URL | Figure it out yourself | **Shown immediately** |

### Why No npm Install?

Veryfront uses Deno with URL imports - dependencies are fetched on-demand and cached:

```typescript
// No node_modules, no package.json install step
import React from "https://esm.sh/react@18";
import { useState } from "react";
```

For the demo, this means:
- **Zero wait time** for dependency installation
- First request fetches deps (cached thereafter)
- No `node_modules` bloat

---

## Architecture

### Flow Diagram

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│  Parse Args │ -> │ Check Auth   │ -> │  Scaffold   │ -> │  Dev Server  │
│    (10ms)   │    │   (cached)   │    │  (parallel) │    │   (ready)    │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
                          │                   │                   │
                          v                   v                   v
                   ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
                   │ Reserve Slug │    │ Push Files  │    │  Wait Enter  │
                   │    (async)   │    │   (async)   │    │   (deploy)   │
                   └──────────────┘    └─────────────┘    └──────────────┘
```

### Key Design Decisions

1. **Optimistic URLs**: Show URLs immediately (based on predictable slug pattern)
2. **Parallel Operations**: Scaffold + reserve slug + start server concurrently
3. **Cached Auth**: Token from `~/.config/veryfront/token` - no network call
4. **Default Template**: AI template (no prompts, no wizard)
5. **Skip Env Prompts**: Use placeholder values for demo speed
6. **Single Keypress Deploy**: Enter → push → deploy → show live URL

---

## Implementation

### Files to Create

#### 1. `/src/cli/commands/new.ts` (~250 lines)

Main command orchestrator:

```typescript
/**
 * New command - Lightning-fast project creation for pro coders
 *
 * One command: create → preview → deploy
 */

export interface NewOptions {
  template?: InitTemplate;      // default: "ai"
  port?: number;                // default: 3000
  skipDeploy?: boolean;         // just scaffold, no server
  integrations?: string[];      // optional integrations
}

export async function newCommand(name: string, options: NewOptions): Promise<void> {
  // 1. Validate name, check directory doesn't exist
  // 2. Create directory and cd into it (process.chdir)
  // 3. Show header with user info (from cached token)
  // 4. Print optimistic URLs immediately
  // 5. Run parallel operations:
  //    - scaffoldProjectFast() - write files with defaults
  //    - reserveProjectSlug() - reserve slug on API
  // 6. Start dev server (in the new directory)
  // 7. Auto-open browser to local URL
  // 8. Wait for Enter keypress
  // 9. Deploy: push + release + deployment
  // 10. Show final URL
}
```

#### 2. `/src/cli/commands/new/fast-scaffold.ts` (~100 lines)

Stripped-down scaffolding (no prompts):

```typescript
/**
 * Fast scaffold - Write template files without any prompts
 */
export async function scaffoldProjectFast(
  projectDir: string,
  template: InitTemplate = "ai"
): Promise<ScaffoldResult> {
  // 1. Load template files from disk
  // 2. Write all files in parallel (Promise.all)
  // 3. Create package.json
  // 4. Create .env with placeholder values
  // 5. Create .veryfrontrc with slug
  // Return: { filesWritten: number, template: string }
}
```

#### 3. `/src/cli/commands/new/reserve-slug.ts` (~60 lines)

API call to reserve project slug:

```typescript
/**
 * Reserve a project slug on the API
 * Returns immediately with success or suggests alternative
 */
export async function reserveProjectSlug(
  slug: string,
  token: string
): Promise<{ slug: string; created: boolean }> {
  // POST /projects { slug }
  // On 409 conflict: try slug-2, slug-3, etc.
  // Return actual slug used
}
```

### Files to Modify

#### 1. `/src/cli/index/command-router.ts`

Add routing for `new` command:

```typescript
case "new": {
  const name = args._[1] as string;
  if (!name) {
    cliLogger.error("Usage: veryfront new <project-name>");
    exitProcess(1);
    return;
  }
  const { newCommand } = await import("../commands/new.ts");
  await newCommand(name, {
    template: (args.t || args.template) as InitTemplate,
    port: args.port ?? 3000,
    skipDeploy: Boolean(args["skip-deploy"]),
  });
  break;
}
```

#### 2. `/src/cli/help/command-definitions.ts`

Add help for `new` command:

```typescript
new: {
  name: "new",
  description: "Create, preview, and deploy a new project in one command",
  usage: "veryfront new <name> [options]",
  examples: [
    "veryfront new my-app",
    "veryfront new my-app -t blog",
    "veryfront new my-app --skip-deploy",
  ],
  options: [
    { flag: "-t, --template <name>", description: "Template (ai, app, blog, docs, minimal)" },
    { flag: "-p, --port <number>", description: "Dev server port (default: 3000)" },
    { flag: "--skip-deploy", description: "Just scaffold, don't start server or deploy" },
  ],
}
```

#### 3. `/deno.json`

Add convenience task (optional):

```json
{
  "tasks": {
    "new": "deno run --allow-all src/cli/main.ts new"
  }
}
```

---

## Output Design (Stage-Optimized)

### Clean Header

```
  Veryfront

  Logged in as kent@veryfront.com
```

- Minimal branding (just "Veryfront", no version clutter)
- Confirm auth immediately (reassurance)

### Progress Display

```
  Creating my-agent...

  Local   http://my-agent.lvh.me:3000
  Live    https://my-agent.veryfront.app
```

- URLs shown immediately (optimistic)
- Aligned for visual clarity
- No spinners (feels faster)

### Ready State

```
  Ready! Press Enter to deploy
```

- Single clear action
- Server is running, user can browse

### Deploy Output

```
  Deploying...

  Done! https://my-agent.veryfront.app
```

- Minimal, clean
- Final URL is the hero

---

## Error Handling (Demo-Safe)

### Auth Not Found

```
  Please log in first:

  deno task cli login
```

Don't try to open browser during demo - just fail fast with clear instructions.

### Slug Taken

```
  "my-agent" is taken, using "my-agent-2"
```

Auto-resolve, don't prompt.

### Directory Exists

```
  Directory "my-agent" already exists. Use --force to overwrite.
```

Clear error, suggest fix.

---

## Testing Plan

1. **Fresh user flow**: No cached token → clear error message
2. **Cached token flow**: Token exists → instant auth display
3. **Scaffold speed**: Measure file write time (target: <200ms)
4. **Server startup**: Measure time to ready (target: <500ms)
5. **Deploy flow**: Enter → live URL (target: <3s)
6. **Slug conflict**: API returns 409 → auto-increment works

---

## Verification

After implementation:

1. Run `deno task cli new test-app`
2. Verify output matches design above
3. Verify local URL works: `http://test-app.lvh.me:3000`
4. Press Enter, verify deploy succeeds
5. Verify live URL works: `https://test-app.veryfront.app`
6. Time the full flow (target: <5 seconds total)

---

## Files Summary

| Action | File | Lines |
|--------|------|-------|
| Create | `/src/cli/commands/new.ts` | ~250 |
| Create | `/src/cli/commands/new/fast-scaffold.ts` | ~100 |
| Create | `/src/cli/commands/new/reserve-slug.ts` | ~60 |
| Modify | `/src/cli/index/command-router.ts` | +15 |
| Modify | `/src/cli/help/command-definitions.ts` | +20 |
| Modify | `/deno.json` (optional) | +1 |

**Total: ~450 lines of new code**
