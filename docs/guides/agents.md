---
title: "Agents"
description: "Create an AI agent with a system prompt, tools, and memory."
order: 18
---

An agent is a file in `agents/` that exports a system prompt, optional tools,
optional memory, and optional skills. The runtime auto-discovers it on startup
and exposes it via `getAgent(id)` or a route created with `createAgUiHandler()`.

For the normal path, omit `model` and let runtime conventions choose: local
inference by default, Veryfront Cloud when `VERYFRONT_API_TOKEN` plus project
context are set.

## Prerequisites

- A Veryfront project running locally (see
  [Create project](../getting-started/create-project.md)).
- A provider configured for inference (see [Providers](./providers.md)).
- The `agents/` directory exists. If you customised `ai.agents.discovery.paths`
  in [Configuration](./configuration.md), use that directory instead.

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

You can also define an agent with markdown when the agent only needs persona,
model, and step configuration:

```md
---
name: Support
description: Helps users with support questions
model: openai/gpt-5.4
max-steps: 6
---

You are a support assistant. Answer clearly and ask for missing details before
acting.
```

The file path provides the agent id. For example, `agents/support.md` registers
`support` and can be invoked through the same project runtime and control-plane
surfaces as `agents/support.ts`.

## Per-agent skills and tools

A markdown agent can own its skills and tools by using a directory instead of a
single file. Put the agent definition in `AGENT.md` and colocate its
capabilities beside it:

```
agents/
  researcher/
    AGENT.md            # the agent definition (frontmatter + instructions)
    SKILL.md            # the agent's own skill, loaded as load_skill("researcher")
    skills/
      cite/SKILL.md     # an extra skill, loaded as load_skill("researcher--cite")
    tools/
      fetch-paper.ts    # a colocated tool, registered as "researcher--fetch-paper"
```

The directory name is the agent id. The flat `agents/{id}.md` form still works
for agents that do not own skills or tools, and both layouts can coexist.

Colocated capabilities are registered with owner metadata and namespaced
`{agentId}--{name}`. Ownership controls visibility everywhere: an agent only
ever sees unowned (project-global) capabilities plus its own - never another
agent's. This one rule applies to `skills:` and `tools:` for every agent kind
(TypeScript, flat markdown, and directory markdown):

```md
---
name: Researcher
model: anthropic/claude-sonnet-4-6
skills: true # all skills visible to this agent (global + own)
tools: [fetch-paper] # own short names resolve first, then global tool ids
---

Research the question and cite every claim.
```

- Omit `skills` or use `skills: true` to advertise every skill visible to the
  agent. Use `skills: []` to advertise none. Skill loading tools remain
  available in either case.
- `tools: true` - every tool visible to the agent.
- `skills: [..]` / `tools: [..]` - each entry resolves as the agent's own
  short name first, then as a global id. A colocated short name that shadows a
  global id is reported at discovery so the reference stays unambiguous.
- Duplicate agent ids (flat file + directory) and agent ids whose sanitized
  namespaces collide are reported as discovery errors.
  The same catalog metadata is used by local and hosted runtime paths. Hosted
  skill loading uses the catalog `sourcePath`, not a path reconstructed from the
  namespaced id, so `load_skill("researcher--cite")` resolves to the actual
  colocated `SKILL.md`.

## Add tools

Agents call tools to take actions or fetch data. Reference tools by name: the
framework resolves them from the `tools/` directory:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a weather assistant.",
  temperature: 0,
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`temperature` controls model sampling and defaults to `0` for deterministic
agent runs. Runtime provider capabilities may omit or normalize the value for
models that reject generic sampling parameters or require mode-specific values.

`maxSteps` limits how many tool-call iterations the agent can perform per
request. See [Tools](./tools.md) for how to define `getWeather`.

## Enable provider tools

Provider tools are executed by the selected model provider. They are not local
tools and they are not MCP tools.

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
  system: "Research current information before answering.",
  providerTools: ["web_search"],
});
```

The runtime only enables provider tools that the selected provider/model
supports.

## Connect MCP servers

Use `mcpServers` for remote MCP-compatible tool servers. Put visibility policy
on the server that owns the tools. When `tools` is an explicit object, include
the remote MCP tool name in `tools` and authorize it with the server
`toolPolicy`.

```ts
// agents/docs.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "docs",
  system: "Use the docs server when the user asks about internal docs.",
  tools: { search_docs: true },
  mcpServers: [
    {
      id: "docs",
      transport: {
        type: "http",
        url: "https://docs.example.com/mcp",
      },
      auth: {
        type: "bearer",
        token: () => process.env.DOCS_MCP_TOKEN ?? "",
      },
      toolPolicy: {
        allow: ["search_docs"],
        approval: "never",
      },
    },
  ],
});
```

## Use skills

Skills are reusable instruction packs discovered from your project's `skills/`
directory. Every agent receives the visible skill catalog and skill loading
tools automatically.

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a support engineer. Use skills when they match the task.",
  tools: {
    Read: true,
    github__list_issues: true,
  },
});
```

Use `skills: ["incident-response", "repo-maintainer"]` to advertise only those
skills. Use `skills: []` to advertise no skills. This selector does not remove
the built-in skill loading tools or restrict which visible skills they can load
by ID:

- `load_skill`
- `load_skill_reference`
- `execute_skill_script`

See [Project structure](./project-structure.md) for `skills/` conventions and
[Configuration](./configuration.md) for discovery paths.

## Skill execution flow

When an agent uses a skill, the flow is:

1. Call `load_skill({ skillId })` to load the skill instructions and policy.
2. Optionally call `load_skill_reference(...)` to read files from
   `references/`, `resources/`, or `assets/`.
3. Optionally call `execute_skill_script(...)` to run scripts from `scripts/`.
4. Continue with normal tool calls under the active skill policy.

The runtime enforces that non-skill tools cannot run before a successful
`load_skill` when both are emitted in the same step.

## Skill script execution

Skill scripts run in one of two modes, selected automatically:

- **Local (development)**: When no Veryfront Cloud sandbox credentials are
  available, scripts run as direct subprocesses on your machine via
  `runCommand()`. No remote sandbox is needed.
- **Cloud (production)**: When `SANDBOX_AUTH_TOKEN`, `VERYFRONT_API_TOKEN`, or
  request-scoped Veryfront credentials are available, scripts are uploaded to
  and executed inside a remote sandbox session.

Local development does not require sandbox infrastructure. Scripts run as direct
subprocesses.

## Skill safety model

- `allowed-tools` in `SKILL.md` is enforced at planning time and execution time
  (fail-closed).
- Skill file reads are restricted to the skill root and allowed subdirectories:
  `references/`, `resources/`, `assets/`, and `scripts/`.
- Symlinked paths are rejected for skill file access.
- Script execution timeout defaults to `60000` ms and is capped at `300000` ms.

## Connect to a route

Expose a registered agent through `createAgUiHandler()` when a browser or
external client needs AG-UI streaming.

Use [Create agent](../getting-started/create-agent.md) for the copyable
quick-start route. Use [Chat UI](./chat-ui.md) to pair that route with
`useChat()`.

If a route returns `Agent not found`, ensure the agent file is in `agents/` and
its `id` matches the value passed to `createAgUiHandler()`.

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
    return `You are a helpful assistant. Current date: ${date}.`;
  },
});
```

For step-boundary refresh during a long-lived run, use `resolveRuntimeState`
instead of relying on `system()` to run again mid-turn.

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a project assistant.",
  resolveRuntimeState: async ({ step }) => {
    if (step === 0) return;

    return {
      system: "Use the latest project instructions before continuing.",
    };
  },
});
```

## Agent configuration

| Property              | Type                                                                                                   | Description                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `id`                  | `string`                                                                                               | Unique identifier used with `getAgent()`                                                              |
| `name`                | `string`                                                                                               | Human-readable display name for listings                                                              |
| `description`         | `string`                                                                                               | Optional summary for listings                                                                         |
| `model`               | `string`                                                                                               | Optional provider/model override. Omit for `openai/gpt-5.4-nano`; use `"auto"` for runtime selection. |
| `system`              | `string \| () => string \| Promise<string>`                                                            | System prompt                                                                                         |
| `resolveRuntimeState` | `(request: RuntimeStateRequest) => ResolvedRuntimeState \| Promise<ResolvedRuntimeState \| undefined>` | Refresh system/context before later model steps in the same run                                       |
| `tools`               | `Record<string, boolean \| Tool>`                                                                      | Tools the agent can use                                                                               |
| `providerTools`       | `string[]`                                                                                             | Provider-executed tools such as `web_search`                                                          |
| `mcpServers`          | `AgentMcpServerConfig[]`                                                                               | Remote MCP-compatible tool servers                                                                    |
| `skills`              | `true \| string[]`                                                                                     | Advertise all visible skills (`true` or omitted), selected IDs, or none (`[]`)                        |
| `temperature`         | `number`                                                                                               | Sampling temperature for model generation (default: `0`)                                              |
| `maxSteps`            | `number`                                                                                               | Max tool-call iterations per request                                                                  |
| `memory`              | `MemoryConfig`                                                                                         | Conversation memory settings                                                                          |
| `streaming`           | `boolean`                                                                                              | Enable streaming (default: `true`)                                                                    |
| `middleware`          | `AgentMiddleware[]`                                                                                    | Execution middleware                                                                                  |
| `allowedModels`       | `string[]`                                                                                             | Restrict runtime model overrides to these `provider/model` strings                                    |

## Verify it worked

Save the agent file, restart `veryfront dev`, and invoke it from server code:

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
const result = await agent.generate({ input: "Hello" });
console.log(result.text);
```

If generation fails, check the dev-server log for agent registration or provider
errors. If AG-UI routing fails, use the route verification in
[Create agent](../getting-started/create-agent.md). A healthy AG-UI stream ends
with a `RunFinished` event.
