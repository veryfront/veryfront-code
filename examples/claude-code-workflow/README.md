# Claude Code Workflow Example

Durable workflows that use Claude Code as a step — code review, bug fixing, and refactoring powered by the Claude Agent SDK.

## What This Shows

- **Claude Code as a workflow tool**: Pre-built tools (`claude-code-review`, `claude-bug-fix`, `claude-refactor`, `claude-docs`) that wrap the Claude Agent SDK for use in workflow steps
- **Multi-step pipelines**: Bug fix workflow chains investigate → fix → verify as three sequential steps
- **Read-only vs read-write**: Analysis mode for reviews, code mode for fixes
- **Inline or distributed**: Runs in-process for quick dev, or via Redis + worker for crash recovery
- **No API key needed**: Uses your local Claude Code installation's auth (Max subscription, API key, org key)

## Quick Start

```bash
# Make sure Claude Code is installed locally
claude --version

# Start the dev server
cd examples/claude-code-workflow
deno task dev
```

Open `http://localhost:3002` for usage examples.

## Workflows

### Code Review (`code-review`)

Single step — Claude Code reads the codebase in analysis mode (no writes) and produces a structured review.

```
analyze (read-only) → report
```

```bash
curl -X POST http://localhost:3002/api/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "code-review",
    "input": { "target": "src/utils/", "focus": "security" }
  }'
```

### Bug Fix (`bug-fix`)

Three steps — investigate the bug (read-only), implement a fix (code mode), verify the fix (read-only).

```
investigate → fix → verify
```

```bash
curl -X POST http://localhost:3002/api/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "bug-fix",
    "input": {
      "description": "Login form accepts empty passwords",
      "files": ["src/auth/login.ts"],
      "errorMessage": "ValidationError: password is required"
    }
  }'
```

### Check Status

```bash
curl http://localhost:3002/api/workflow?id=<runId>
```

## Available Claude Code Tools

These are pre-built tools from `veryfront/workflow/claude-code`:

| Tool | Mode | Purpose |
|---|---|---|
| `claude-code` | code | General-purpose (all Claude Code tools) |
| `claude-code-review` | analysis | Code review (read-only) |
| `claude-bug-fix` | code | Bug investigation and fixing |
| `claude-refactor` | code | Code refactoring |
| `claude-docs` | code | Documentation generation |

### Creating Custom Tools

```typescript
import { createClaudeCodeTool } from "veryfront/workflow/claude-code";

const migrationTool = createClaudeCodeTool({
  id: "migrate-react",
  description: "Migrate React components to latest version",
  defaultMode: "code",
  defaultMaxTurns: 25,
  system: `You are a React migration expert. Upgrade components to React 19
    while maintaining backwards compatibility. Run tests after each change.`,
});
```

### Using the Agent Directly

```typescript
import { executeAgent, createAgent } from "veryfront/workflow/claude-code";

// One-off execution
const result = await executeAgent("Fix the failing tests in src/utils", {
  cwd: "/path/to/project",
  mode: "code",
});

// Reusable agent with preset config
const reviewer = createAgent({
  mode: "analysis",
  systemPrompt: "You are an expert code reviewer.",
});

const review = await reviewer("Review src/auth/ for security issues");
```

## Running with Worker (Crash Recovery)

For workflows that should survive server restarts:

```bash
# Terminal 1: Start Redis
docker run -p 6379:6379 redis:7-alpine

# Terminal 2: Start dev server
deno task dev

# Terminal 3: Start worker
veryfront worker
```

Then modify the API route to use a Redis backend:

```typescript
import { WorkflowClient, RedisBackend } from "veryfront/workflow";

const client = new WorkflowClient({
  backend: new RedisBackend({ url: "redis://localhost:6379" }),
});
```

## Directory Structure

```
claude-code-workflow/
├── app/
│   ├── api/workflow/route.ts   # API to start/check workflows
│   └── page.tsx                # Simple UI with curl examples
├── workflows/
│   ├── code-review.ts          # Code review workflow
│   ├── bug-fix.ts              # Bug fix workflow (3 steps)
│   └── index.ts                # Barrel exports
├── veryfront.config.ts
└── README.md
```

## How It Works

1. **API route** receives a POST with `{ workflow, input }`
2. **WorkflowClient** creates a run and executes steps
3. Each step calls a **Claude Code tool** which:
   - Uses the Claude Agent SDK to spawn your local Claude Code
   - Claude Code has all tools built-in (bash, file editor, search, etc.)
   - Runs an agentic loop until the task is complete or max turns reached
4. Results flow through the DAG — each step's output is available to the next
5. Final status available via GET with the run ID

## Authentication

The Claude Agent SDK uses your local Claude Code installation's auth. No separate `ANTHROPIC_API_KEY` needed — it uses whatever your `claude` binary is configured with:

- **Claude Max subscription** — works automatically
- **API key** — if configured via `claude auth`
- **Org key** — for team deployments

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | No | Redis URL (only for worker mode) |
