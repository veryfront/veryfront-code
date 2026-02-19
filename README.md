# Veryfront

The full-stack React framework for agentic AI apps. Works with Node.js, Deno, and Bun.

```bash
npm create veryfront
```

<details>
<summary>pnpm, yarn, bun, deno</summary>

```bash
pnpm create veryfront
yarn create veryfront
bun create veryfront
deno init --npm veryfront
```

Binary install (recommended for the CLI/TUI):

```bash
curl -fsSL https://veryfront.com/install.sh | sh
# or
brew install veryfront/tap/veryfront
```

</details>

## What You Get

Agents, tools, and workflows are files. Auto-discovered, no registration needed.

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

## Define Agent

Agents have a model, system prompt, and optional tools and memory.

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

## Define Tool

Tools are Zod-validated functions an agent can call.

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

## Define Prompt

Versioned system prompts with `{{variable}}` support.

```ts
// prompts/assistant.ts
import { prompt } from "veryfront/prompt";

export default prompt({
  description: "General-purpose assistant",
  content: "You are a helpful assistant for {{company}}.",
});
```

## Expose Chat Endpoint

One-line API route via `createChatHandler`, or use `getAgent` for full control.

```ts
// app/api/chat/route.ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("assistant");
```

<details>
<summary>Manual handler with getAgent</summary>

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

</details>

## Add Chat UI

Pre-built `<Chat />` component with streaming and tool call rendering.

```tsx
// app/page.tsx
"use client"
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

## Define Workflow

Multi-step DAG pipelines with branching, parallelism, and human-in-the-loop.

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

## Compose Agents

For advanced setups, agents can delegate to other agents as tools.

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

## Templates

```bash
npx veryfront init my-app
```

| Template | Description |
|----------|-------------|
| **chat** | AI chatbot with agent, tools, streaming UI |
| **rag** | Chat with your docs via retrieval-augmented generation |
| **multi-agent** | Agents that delegate to each other as tools |
| **workflow** | Multi-step AI pipeline with approvals and parallelism |
| **coding-agent** | AI code assistant with file read/write/edit tools |
| **saas** | AI SaaS with auth, per-user chat, memory |
| **minimal** | Blank canvas |

## Deploy

Push, merge, and ship from the command line.

```bash
veryfront push                # Upload to a branch
veryfront merge my-branch     # Merge into main
veryfront deploy              # Release to production
```

Preview at `https://<slug>--<branch>.preview.veryfront.com`, production at `https://<slug>.production.veryfront.com`.

## Terminal UI

Browse projects, view logs, and open in browser or IDE.

```bash
veryfront
```

```
╭──────────────────────────────────────────────────────────╮
│                                                          │
│  ○ ○ ○ ○ ○ ○ ○                                           │
│  ○ ● ● ● ○ ○ ○   Veryfront is now running                │
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

Give your coding agent access to live errors, logs, and HMR.

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

Apache-2.0
