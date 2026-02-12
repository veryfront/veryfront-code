# Veryfront Code

The full-stack React framework for AI applications. Agents, tools, workflows — one framework, zero config.

```bash
# Interactive wizard
pnpm create veryfront

# Or with project name
npx veryfront init my-app
cd my-app
veryfront dev
```

## What You Get

Define agents, tools, and workflows as files. They're auto-discovered — no registration, no wiring.

```
my-app/
  agents/
    assistant.ts      # AI agent with model, system prompt, tools
  tools/
    search.ts         # Zod-validated tool the agent can call
  prompts/
    assistant.ts      # System prompt (versioned, swappable)
  workflows/
    pipeline.ts       # DAG workflow with branching + parallelism
  app/
    layout.tsx        # Root layout
    page.tsx          # Chat UI
    api/
      chat/
        route.ts      # Streaming chat endpoint
```

## Define an Agent

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful assistant.",
  tools: true,       // auto-attach all discovered tools
  maxSteps: 10,
});
```

## Define a Tool

```ts
// tools/search.ts
import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    // your logic here
    return { results: [] };
  },
});
```

## Stream to the Frontend

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

## Chat UI in One Line

```tsx
// app/page.tsx
'use client'
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

## Workflows

DAG-based multi-step workflows with branching, parallelism, and human-in-the-loop.

```ts
// workflows/content-pipeline.ts
import { workflow, step, parallel, waitForApproval } from "veryfront/workflow";

export default workflow({
  id: "content-pipeline",
  steps: () => [
    step("research", { agent: "researcher" }),
    parallel("generate", [
      step("write", { agent: "writer" }),
      step("images", { tool: "imageGenerator" }),
    ]),
    waitForApproval("review", { timeout: "24h" }),
    step("publish", { agent: "publisher" }),
  ],
});
```

## Multi-Agent Composition

Use agents as tools for other agents.

```ts
import { agent, registerAgent, getAgentsAsTools } from "veryfront/agent";

const researcher = agent({ model: "openai/gpt-4o", system: "Research topics thoroughly." });
const writer = agent({ model: "openai/gpt-4o", system: "Write clear, concise prose." });

registerAgent(researcher);
registerAgent(writer);

const orchestrator = agent({
  model: "openai/gpt-4o",
  system: "Coordinate research and writing.",
  tools: getAgentsAsTools(["researcher", "writer"]),
});
```

## Features

| | |
|---|---|
| **Agents** | Define AI agents with memory, tools, and streaming |
| **Tools** | Zod-validated, auto-discovered, type-safe |
| **Workflows** | DAG orchestration with branching, loops, and human approval |
| **Chat UI** | `<Chat />` component + `useChat` hook, ready to go |
| **Multi-agent** | Agent-as-tool composition and delegation |
| **Providers** | Unified interface for OpenAI, Anthropic, Google |
| **MCP Server** | Expose your tools and prompts over Model Context Protocol |
| **OAuth** | 37 pre-configured providers (Google, GitHub, etc.) |
| **Routing** | File-based routing with layouts, SSR, and RSC |
| **Middleware** | CORS, rate limiting, logging, custom pipelines |
| **MDX** | Markdown pages with React components |
| **Deploy** | `veryfront deploy` to managed cloud |

## Templates

```bash
npx veryfront init my-app
```

- **chat** — AI chatbot with agent, tools, and streaming UI
- **rag** — Chat with your docs using retrieval-augmented generation
- **multi-agent** — Agents that delegate to each other as tools
- **workflow** — Multi-step AI pipeline with approvals and parallelism
- **coding-agent** — AI code assistant with file read/write/edit tools
- **saas** — AI SaaS with auth, per-user chat, and memory
- **minimal** — Blank canvas, no extras

## Build & Deploy

```bash
veryfront build
veryfront deploy
```

Your app is live at `https://<slug>.veryfront.com`.

---

## Terminal UI

The dev server includes an interactive TUI with project management.

```
╭──────────────────────────────────────────────────────────╮
│                                                          │
│  ○ ○ ○ ○ ○ ○ ○                                           │
│  ○ ● ● ● ○ ○ ○   Veryfront Code is now running           │
│  ○ ● ● ● ○ ○ ○                                           │
│  ○ ● ● ○ ● ● ○   Url http://veryfront.me:8080            │
│  ○ ○ ○ ● ● ● ○   Mcp http://veryfront.me:9999/mcp        │
│  ○ ○ ○ ● ● ● ○                                           │
│  ○ ○ ○ ○ ○ ○ ○                                           │
│                                                          │
╰──────────────────────────────────────────────────────────╯
```

<details>
<summary>Keyboard shortcuts</summary>

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate projects |
| `enter` | Open selected project |
| `o` | Open in browser |
| `s` | Open in Studio |
| `i` | Open in IDE |
| `n` | Create new project |
| `l` | Toggle logs |
| `q` | Quit |

</details>

## Connect Your Coding Agent

Veryfront exposes an MCP server that gives AI coding agents access to live dev server state — errors, logs, and HMR triggers.

<details>
<summary>Claude Code</summary>

```bash
/plugin install veryfront@veryfront/claude-plugins
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

</details>

<details>
<summary>Cursor</summary>

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

</details>

<details>
<summary>Codex CLI</summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.veryfront]
command = "veryfront"
args = ["mcp"]
```

</details>

<details>
<summary>Gemini CLI</summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

</details>

**Available MCP tools:**

| Tool | Description |
|------|-------------|
| `vf_get_errors` | Live compile, runtime, and bundle errors |
| `vf_get_logs` | Recent server logs with filtering |
| `vf_get_status` | Dev server status and stats |
| `vf_trigger_hmr` | Trigger hot module reload |

## Documentation

- [Quickstart](https://veryfront.com/code/guides/quickstart)
- [Project Structure](https://veryfront.com/code/guides/project-structure)
- [Agents](https://veryfront.com/code/guides/agents)
- [Tools](https://veryfront.com/code/guides/tools)
- [Workflows](https://veryfront.com/code/guides/workflows)
- [Chat UI](https://veryfront.com/code/guides/chat-ui)
- [API Reference](https://veryfront.com/code/api)

## License

MIT
