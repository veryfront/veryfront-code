# Coding Agent Example

An AI coding assistant powered by the **Claude Agent SDK**. All tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch) are built-in — no manual tool implementations needed.

## Setup

1. **Install Claude Code** (provides authentication):
   ```bash
   claude --version  # Verify installation
   ```

2. **Start the development server:**
   ```bash
   deno run --allow-all ../../src/cli/main.ts dev
   ```

3. **Open in browser:**
   ```
   http://localhost:3000
   ```

No `ANTHROPIC_API_KEY` required — the SDK uses your local Claude Code installation's auth (Max subscription, API key, or org key).

## How It Works

The API route (`app/api/agent/route.ts`) dynamically imports the Claude Agent SDK and streams responses as Server-Sent Events:

```typescript
const { query } = await import("@anthropic-ai/claude-agent-sdk");

const conversation = query({
  prompt: "Read veryfront.config.ts and explain it",
  options: {
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    maxTurns: 15,
  },
});

for await (const message of conversation) {
  // Stream text and tool calls as SSE events
}
```

The frontend (`app/page.tsx`) provides a chat UI that parses the SSE stream and renders text + tool call cards.

## Example Prompts

- "Read the veryfront.config.ts and explain what it does"
- "Search for TODO comments using grep"
- "Run the tests and summarize the results"
- "Create a new utility file with a string capitalize function"
- "Search the web for Deno 2.0 new features"

## Architecture

```
coding-agent/
├── app/
│   ├── api/agent/route.ts    # Claude Agent SDK + SSE streaming
│   └── page.tsx              # Chat UI with tool call visualization
├── veryfront.config.ts       # App router config
└── README.md
```

## Authentication

The Claude Agent SDK supports multiple auth methods (in priority order):

1. **Claude Code local auth** — uses your existing `claude` installation
2. **API key** — set `ANTHROPIC_API_KEY` environment variable
3. **Organization key** — for team deployments

For local development, option 1 "just works" with no configuration.
