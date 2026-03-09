---
title: "Agents"
description: "Create an AI agent with a system prompt, tools, and memory."
order: 6
---

# Agents

Create an AI agent with a system prompt, tools, and memory.

For the normal path, omit `model`. Veryfront uses runtime conventions:
local inference by default, and Veryfront Cloud defaults when
`VERYFRONT_API_TOKEN` plus project context are available.

## Define an agent

Create a file in `agents/`:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant. Answer concisely.",
});
```

The `id` is how you reference the agent later with `getAgent("assistant")`.

## Add tools

Agents call tools to take actions or fetch data. Reference tools by name — the framework resolves them from the `tools/` directory:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a weather assistant.",
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`maxSteps` limits how many tool-call iterations the agent can perform per request. See [Tools](./tools.md) for how to define `getWeather`.

## Enable skills

Skills are reusable instruction packs discovered from your project's `skills/` directory.

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a support engineer. Use skills when they match the task.",
  skills: ["incident-response", "repo-maintainer"], // or `true` for all discovered skills
  tools: {
    Read: true,
    "github:list-issues": true,
  },
});
```

When `skills` is enabled, the runtime automatically registers these skill tools:

- `load-skill`
- `load-skill-reference`
- `execute-skill-script`

See [Project Structure](./project-structure.md) for `skills/` conventions and [Configuration](./configuration.md) for discovery paths.

## Skill execution flow

For skill-aware agents, the recommended flow is:

1. Call `load-skill({ skillId })` to load the skill instructions and policy.
2. Optionally call `load-skill-reference(...)` to read files from `references/` or `assets/`.
3. Optionally call `execute-skill-script(...)` to run scripts from `scripts/`.
4. Continue with normal tool calls under the active skill policy.

The runtime enforces that non-skill tools cannot run before a successful `load-skill` when both are emitted in the same step.

## Skill script execution

Skill scripts run in one of two modes, selected automatically:

- **Local (development)**: When no Veryfront Cloud sandbox credentials are available, scripts run as direct subprocesses on your machine via `runCommand()`. No remote sandbox is needed.
- **Cloud (production)**: When `SANDBOX_AUTH_TOKEN`, `VERYFRONT_API_TOKEN`, or request-scoped Veryfront credentials are available, scripts are uploaded to and executed inside a remote sandbox session.

You don't need any sandbox infrastructure for local development — scripts just run directly.

## Skill safety model

- `allowed-tools` in `SKILL.md` is enforced at planning time and execution time (fail-closed).
- Skill file reads are restricted to the skill root and allowed subdirectories.
- Symlinked paths are rejected for skill file access.
- Script execution timeout defaults to `60000` ms and is capped at `300000` ms.

## Connect to a route

Use `getAgent()` to retrieve a registered agent and stream its response:

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

## Non-streaming response

For server-side generation (e.g., in `getServerData`), use `generate()`:

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
const result = await agent.generate({
  input: "Summarize the latest news about AI.",
});

console.log(result.text); // The agent's response
console.log(result.toolCalls); // Tools the agent called
console.log(result.usage); // Token usage
```

## Dynamic system prompts

The `system` property accepts a string, a function, or an async function:

```ts
export default agent({
  id: "assistant",
  system: async () => {
    const date = new Date().toLocaleDateString();
    return `You are a helpful assistant. Today is ${date}.`;
  },
});
```

## Agent configuration

| Property        | Type                                        | Description                                                                           |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `id`            | `string`                                    | Unique identifier used with `getAgent()`                                              |
| `model`         | `string`                                    | Optional provider/model override. Omit or use `"auto"` for runtime defaults. |
| `system`        | `string \| () => string \| Promise<string>` | System prompt                                                                         |
| `tools`         | `Record<string, boolean \| Tool>`           | Tools the agent can use                                                               |
| `maxSteps`      | `number`                                    | Max tool-call iterations per request                                                  |
| `memory`        | `MemoryConfig`                              | Conversation memory settings                                                          |
| `streaming`     | `boolean`                                   | Enable streaming (default: `true`)                                                    |
| `middleware`    | `AgentMiddleware[]`                         | Execution middleware                                                                  |
| `allowedModels` | `string[]`                                  | Restrict runtime model overrides to these `provider/model` strings                    |
| `skills`        | `true \| string[]`                          | Enable all skills (`true`) or only specific skill IDs                                 |

## Next

- [Tools](./tools.md) — define the tools your agent calls
- [Memory & Streaming](./memory-and-streaming.md) — add conversation memory

## Related

- [`veryfront/agent`](../reference/agent.md) — agent API reference
