---
title: "Multi-agent"
description: "Agent composition, delegation, and agent-as-tool patterns."
order: 28
---

Veryfront supports two agent composition patterns:

- Wrap agents as tools with `agentAsTool` or `getAgentsAsTools`.
- Run agents as ordered workflow steps.

Use agent-as-tool when the parent should choose the order at runtime. Use a workflow when the order is known in advance.

Each agent can omit `model` and use `openai/gpt-5.4-nano`, set `"auto"` for runtime selection, or set an explicit `provider/model` override when you need one.

## Prerequisites

- At least two agents in `agents/` (see [Agents](./agents.md)).
- A configured provider (see [Providers](./providers.md)).

## Agent-as-tool

Convert an agent into a tool that another agent can call:

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
  system: "Research topics thoroughly using web search.",
  providerTools: ["web_search"],
  maxSteps: 5,
});
```

Provider-native web search uses the `web_search` tool name and requires a
provider/model that supports it. Use `providerTools` for provider-executed
tools. Use `tools` for local tools that your app defines.

```ts
// agents/writer.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "writer",
  system: "Write clear, well-structured articles.",
});
```

```ts
// agents/orchestrator.ts
import { agent, getAgentsAsTools } from "veryfront/agent";

export default agent({
  id: "orchestrator",
  system:
    "You coordinate research and writing. Use the researcher to gather facts, then the writer to produce the article.",
  tools: getAgentsAsTools({
    researcher: "Research a topic using web search",
    writer: "Write an article from research notes",
  }),
  maxSteps: 10,
});
```

`getAgentsAsTools()` wraps each agent as a tool. The orchestrator decides when to call each agent based on its system prompt. Each sub-agent runs its own tool loop independently.

### Invoke the orchestrator

Expose the orchestrator through an AG-UI route:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("orchestrator");
```

Run the dev server and ask for an output that requires delegation:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Research Deno Deploy and write a short technical summary."}]}]}'
```

The orchestrator receives the user message, then calls `researcher` and `writer` as tools when the model decides they are needed.

### Single agent-as-tool

For wrapping a single agent:

```ts
import { agentAsTool, getAgent } from "veryfront/agent";

const researcher = getAgent("researcher");
const researchTool = agentAsTool(researcher, "Research a topic using web search");
```

## Declarative delegation with `delegates`

Code and markdown agents can opt into orchestration by listing the exact
specialists they may call. The runtime gives the agent one `agent_{id}` tool
per delegate. Each scoped tool accepts `{ input: string }` and runs the actual
delegate definition with its own model, skills, MCP servers, and tools.

```ts
// agents/orchestrator.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "orchestrator",
  system: "Use agent_researcher, then agent_writer.",
  delegates: ["researcher", "writer"],
});
```

The same configuration is available in markdown frontmatter:

```md
---
name: Lead
description: Plans the work and routes to specialists
delegates: [researcher, writer]
---

Break the task down. Use agent_researcher to gather facts, then agent_writer to
produce the final copy.
```

Set `delegates: []` when an agent must not delegate. Hosted runtimes retain the
legacy generic `invoke_agent` tool only for older definitions where
`delegates` is absent; direct runtimes do not add it automatically.
Self-delegation and delegate ids that cannot form a valid provider tool name
are rejected with explicit diagnostics. Declare direct tools by name when
using `delegates`; `tools: true` is intentionally rejected because it would
hide the agent's capability boundary.

Hosted nested delegation carries trusted invocation lineage from parent to
child runs. The root conversation and run stay stable, the immediate parent is
updated for each handoff, and hosted runtimes stop delegation after eight
nested levels.

## Workflow-based composition

For deterministic multi-agent pipelines, use [workflows](./workflows.md):

```ts
// workflows/article-pipeline.ts
import { parallel, step, workflow } from "veryfront/workflow";

export default workflow({
  id: "article-pipeline",
  steps: [
    step("research", { agent: "researcher" }),
    parallel("drafts", [
      step("draft-1", { agent: "writer", input: "Style: conversational" }),
      step("draft-2", { agent: "writer", input: "Style: technical" }),
    ]),
    step("select", { agent: "editor" }),
  ],
});
```

Start this workflow from an API route, task, or tool. The [Workflows](./workflows.md) guide shows a copyable `createWorkflowClient()` start route.

## When to use which

| Pattern           | Use when                                                                    |
| ----------------- | --------------------------------------------------------------------------- |
| **Agent-as-tool** | The orchestrator decides dynamically which agents to call and in what order |
| **Workflow**      | The execution order is known in advance: sequential, parallel, or branching |

Agent-as-tool is more flexible but harder to predict. Workflows are deterministic and easier to debug.

## Agent registry

All agents in `agents/` are registered automatically. Access them programmatically:

```ts
import { getAgent, getAllAgentIds } from "veryfront/agent";

const ids = getAllAgentIds(); // ["assistant", "researcher", "writer"]
const agent = getAgent("writer"); // Get a specific agent
```

## Verify it worked

After wiring delegation, run a request against the orchestrator and watch
the dev-server logs:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Research and summarise the latest npm release."}]}]}'
```

A working delegation:

- Logs show the orchestrator calling each sub-agent in order.
- The final AG-UI response contains output that could only come from the
  sub-agents (research output then writer output, for example).

For workflows, hit the workflow start route from
[Workflows](./workflows.md) and follow `runId` events instead.
