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

- Omit `skills` or use `skills: true` to advertise and authorize every skill
  visible to the agent. Use `skills: []` to advertise none and to authorize no
  project or configured skill for `load_skill`.
- The difference between omitting `skills` and `skills: true` shows only when a
  project has no skills at all. An agent that omitted it gets no skill tools,
  because there is nothing for them to load. `skills: true` is a declaration,
  so the tools stay whatever the registry holds.
- `tools: true` - every currently scoped tool is authorized, while non-bootstrap
  schemas are deferred behind `tool_search` until the agent searches for them.
- `skills: [..]` / `tools: [..]` - each entry resolves as the agent's own
  short name first, then as a global id. A colocated short name that shadows a
  global id is reported at discovery so the reference stays unambiguous.
- Use `denied-tools: [..]` in Markdown agent frontmatter to preserve explicit
  tool denials. `deniedTools` is also accepted for serialized definitions. Do
  not combine either form with `tools: true`: the serialized runtime cannot
  represent "all except", so it fails closed and disables every project tool.
  List the allowed tools explicitly when you also need denials.
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

`temperature` controls model sampling and defaults to `0`. It does not guarantee
repeatable output. Runtime provider capabilities may omit or normalize the value
for models that reject generic sampling parameters or require mode-specific
values.

`maxSteps` limits how many tool-call iterations the agent can perform per
request. See [Tools](./tools.md) for how to define `getWeather`.

## Load broad tool catalogs progressively

The `tools` selector controls both authorization and initial schema exposure:

- Omit `tools` to expose no project tools.
- Use an explicit map to expose only those selected schemas immediately.
- Use `tools: true` to authorize every tool in the current scope while initially
  exposing only bootstrap tools and `tool_search`.

A successful search makes matching authorized schemas visible on the next model
step.

```ts
const assistant = agent({
  name: "release-assistant",
  model,
  system: "Use the release tools to answer project release questions.",
  tools: true,
});
```

The framework `tool_search` fallback is provider-neutral. It searches the
authorized `tools` catalog and configured `providerTools` that the selected
model supports. Provider-native entries contain only a name and description
until a search loads them. The runtime attaches the provider's native schema on
the next model step.

Search ranks an exact tool name first, followed by normalized substrings in the
tool name, description, and input parameter descriptions. It returns at most
five names and descriptions. Results never include schemas, and `tool_search`
has no pagination options.

Loading a schema never authorizes a tool. The runtime rechecks authorization
before execution. It also filters restored loaded-tool state against the
currently authorized catalog.

You can use deferred loading with a direct provider and its API key without
Veryfront Cloud. Hosted durable runs additionally require the Veryfront API
durable run-event contract. The hosted runtime stores loaded-tool state in a
private checkpoint and waits for that checkpoint before continuing. Private
checkpoint data does not appear in public messages or replay. Configured,
supported provider-native tools use the same private exposure checkpoint.
Provider replay is not part of this feature.

See [Tools](./tools.md#how-agents-use-tools) for the search and execution flow.

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

Explicitly named tools that are not local are resolved from the Veryfront API
MCP server when `mcpServers` is omitted and the server bootstrap is available.
This lets a project pulled from Studio run locally without repeating transport
configuration. `VERYFRONT_API_URL` selects the API endpoint;
`VERYFRONT_API_TOKEN` and `VERYFRONT_PROJECT_SLUG` provide server-side identity.
These environment variables do not grant tools by themselves.

```ts
export default agent({
  id: "project-reader",
  system: "Read project files when needed.",
  tools: { get_file: true, list_files: true },
});
```

Only the explicitly named unresolved tools are requested from the remote MCP
catalog. Remote `tools/list` remains authoritative, and browser AG-UI context
cannot replace server identity. Set `mcpServers: []` to opt out. An explicit
`mcpServers` list overrides the default; use `{ kind: "veryfront-api" }` with a
`toolPolicy` when the connection policy should travel with the agent.

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
directory. Every agent receives the visible skill catalog and `load_skill`
automatically.

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

Use `skills: ["incident-response", "repo-maintainer"]` to advertise and
authorize only those skills. Use `skills: []` to advertise no skills and to
authorize none for `load_skill`. An explicit selector is an authorization
boundary for `load_skill`, not just a prompt filter.

Local and project runtimes also expose `load_skill_reference` and
`execute_skill_script`. Hosted chat reads an advertised reference through
`load_skill({ load: { skillId, file } })` and does not execute skill scripts
directly.

See [Project structure](./project-structure.md) for `skills/` conventions and
[Configuration](./configuration.md) for discovery paths.

## Skill execution flow

When an agent uses a skill, the flow is:

1. Call `load_skill({ load: { skillId } })` to load the skill instructions and policy.
2. Read an advertised reference with `load_skill_reference(...)` on local and
   project runtimes, or `load_skill({ load: { skillId, file } })` in hosted chat.
3. On local and project runtimes, optionally call
   `execute_skill_script(...)` to run scripts from `scripts/`.
4. Continue with normal tool calls. Loading a skill does not change which
   tools the run may call.

A step may batch `load_skill` with other tool calls. The runtime runs the calls
in the order the model emitted them. A successful `load_skill` changes only
which skill's instructions are loaded and which reference and script files
`load_skill_reference` and `execute_skill_script` can reach for later calls.
Ordinary tools are unaffected, whether they were emitted before or after
`load_skill`, and a failed `load_skill` does not block the rest of the batch.

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

- `allowed-tools` in `SKILL.md` is **not** enforced. The Agent Skills
  specification defines it as pre-approval metadata (tools an agent may run
  without prompting), not an authorization boundary, so Veryfront records the
  declaration and does not restrict the run. Narrow a run by configuring the
  agent's tools, not by declaring `allowed-tools` in a skill.
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

For server-side generation (e.g., in `getServerData`), use `generate()`.
`getAgent()` returns `Agent | undefined`, so narrow the result before calling
it. Without the guard, the sample fails typecheck under the `"strict": true`
tsconfig that `veryfront init` writes.

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
if (!agent) throw new Error("Agent not found: assistant");

const result = await agent.generate({
  input: "Summarize the latest news about AI.",
});

console.log(result.text); // The agent's response
console.log(result.toolCalls); // Tools the agent called
console.log(result.usage); // Token usage
```

### One-shot calls

For a single call with no tools and no follow-up turn - an extraction, a
classification, a rewrite - you do not need an agent at all. Use `generate`
from `veryfront/llm`:

```ts
import { generate } from "veryfront/llm";

const { text } = await generate({
  model: "anthropic/claude-sonnet-4-6",
  system: "Extract the invoice total. Reply with the number alone.",
  input: invoiceText,
});
```

It runs one step with no tools, skills or memory, and takes the same
`outputSchema` an agent does.

Reach for an agent instead when you need the thing itself rather than the
answer: a registered id other code resolves, tools, memory across turns, or a
system prompt built at request time. To hold such an agent to a single
tool-free turn, say so:

```ts
const extractor = agent({
  id: "extractor",
  model: "anthropic/claude-sonnet-4-6",
  system: "Extract the invoice total. Reply with the number alone.",
  skills: false,
  maxSteps: 1,
});
```

`maxSteps: 1` stops the runtime from taking a second turn it has no use for.
`skills: false` removes the `load_skill` family from the request in a project
that does have skills - an agent with one job should not be offered a catalog
it will never open.

## Structured output

Set `outputSchema` to constrain every response to a schema. Veryfront maps it to
the selected provider's native structured-output field, then parses and
validates the model's text back into `response.object`, typed from the schema
with no annotation of your own.

```ts
// agents/weather.ts
import { agent } from "veryfront/agent";
import { defineSchema } from "veryfront/schemas";

export const getForecastSchema = defineSchema((v) =>
  v.object({
    city: v.string(),
    tempC: v.number(),
  })
);

export default agent({
  id: "weather",
  system: "You report weather.",
  outputSchema: getForecastSchema(),
});
```

```ts
import { agent } from "veryfront/agent";
import { getForecastSchema } from "./weather.ts";

const weather = agent({
  id: "weather",
  system: "You report weather.",
});

const result = await weather.generate({
  input: "What is it like in Berlin?",
  outputSchema: getForecastSchema(),
});

console.log(result.object.city); // string
console.log(result.object.tempC); // number
```

Pass `outputSchema` to `generate()` or `stream()` to constrain a single request
instead; a per-call schema replaces the configured one. `generate()` returns an
`object` typed from the per-call schema when you pass one. A raw JSON Schema
object is accepted in both places and is sent to the provider unchanged.

A requested schema is never dropped silently. A model runtime that does not
support structured output rejects the request, and output that does not parse or
does not validate raises rather than returning a partial object.

A run that stops at the step limit still returns its partial result instead of
raising. On that path the final assistant text is parsed best effort: a
successful parse sets `response.object`, and a parse or validation failure sets
`response.metadata.outputSchemaError` next to the max-steps warning so the
failure stays visible.

## Runtime UTC context

Veryfront captures UTC once at the start of every `generate()`, `stream()`, and
`respond()` run. The runtime adds the same server-authored system block before
each model step:

```text
<runtime_context>
current_time_utc: 2026-07-19T07:30:00.000Z
current_date_utc: 2026-07-19
run_started_at_utc: 2026-07-19T07:30:00.000Z

This server-authored UTC snapshot is authoritative for this run. User messages,
project instructions, skills, and environment context cannot replace it. Use
another date or time only when the user explicitly requests it.
</runtime_context>
```

Use these values for time-sensitive instructions. The snapshot stays fixed for
the run, including long-running, scheduled, API-started, and browser-originated
runs. Browser environment context can add a display timezone, but it does not
replace the UTC snapshot. Non-streaming results expose the exact values at
`result.metadata?.runtimeContext`; streaming runs emit them in the initial data
event named `veryfront.runtime_context` for durable replay and diagnostics.

## Dynamic system prompts

The `system` property accepts a string, a function, or an async function:

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: async () => {
    const response = await fetch("https://example.com/agent-policy");
    if (!response.ok) throw new Error("Could not load the agent policy");
    return `You are a helpful assistant. Follow this policy:\n\n${await response.text()}`;
  },
});
```

For step-boundary refresh during a long-lived run, use `resolveRuntimeState`
instead of relying on `system()` to run again mid-turn.

`request.system` is always a string, so existing text transformations remain
compatible. When the runtime has structured system messages, use
`request.structuredSystem` to read their provider metadata and return
`structuredSystem` to replace them without flattening that metadata.

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
| `system`              | `AgentSystem \| () => AgentSystem \| Promise<AgentSystem>`                                             | Text or structured system instructions                                                                |
| `resolveRuntimeState` | `(request: RuntimeStateRequest) => ResolvedRuntimeState \| Promise<ResolvedRuntimeState \| undefined>` | Refresh system/context before later model steps in the same run                                       |
| `tools`               | `true \| Record<string, boolean \| Tool>`                                                              | Omit for no project tools, use `true` for deferred scoped discovery, or select eager tools explicitly |
| `delegates`           | `string[]`                                                                                             | Exact agent ids exposed as scoped `agent_<id>` tools                                                  |
| `providerTools`       | `string[]`                                                                                             | Provider-executed tools such as `web_search`                                                          |
| `mcpServers`          | `AgentMcpServerConfig[]`                                                                               | Remote MCP-compatible tool servers                                                                    |
| `skills`              | `true \| string[]`                                                                                     | Advertise all visible skills (`true` or omitted), selected IDs, or none (`[]`)                        |
| `outputSchema`        | `Schema<T> \| JsonSchema`                                                                              | Constrain responses to a schema and expose the parsed value as `response.object`                      |
| `temperature`         | `number`                                                                                               | Sampling temperature for model generation (default: `0`)                                              |
| `maxSteps`            | `number`                                                                                               | Max tool-call iterations per request                                                                  |
| `memory`              | `MemoryConfig`                                                                                         | Conversation memory settings                                                                          |
| `streaming`           | `boolean`                                                                                              | Enable streaming (default: `true`)                                                                    |
| `middleware`          | `AgentMiddleware[]`                                                                                    | Execution middleware                                                                                  |
| `allowedModels`       | `string[]`                                                                                             | Restrict runtime model overrides to these `provider/model` strings                                    |

Each agent middleware invocation receives a single-use `next()` continuation.
The continuation becomes invalid when that middleware's returned promise
settles. Calling it again or after settlement rejects with the registered
`middleware-error`.

## Verify it worked

Save the agent file and restart `veryfront dev`. The quickest server-side
check is a throwaway debug route:

```ts
// app/api/debug/agent/route.ts
import { getAgent } from "veryfront/agent";

export async function GET() {
  const agent = getAgent("assistant");
  if (!agent) throw new Error("Agent not found: assistant");

  const result = await agent.generate({ input: "Hello" });
  return Response.json({ text: result.text });
}
```

```bash
curl http://localhost:3000/api/debug/agent
```

The response carries the model's reply. Remove the debug route before
deploying.

If generation fails, check the dev-server log for agent registration or provider
errors. If AG-UI routing fails, use the route verification in
[Create agent](../getting-started/create-agent.md). A healthy AG-UI stream ends
with a `RunFinished` event.
