---
title: "Multi-agent"
description: "Agent composition, delegation, and agent-as-tool patterns."
order: 19
---

# Multi-agent

Agent composition, delegation, and agent-as-tool patterns.

Each agent can omit `model` and inherit the runtime default, or set an
explicit provider/model override when you need one.

## Agent-as-tool

Convert an agent into a tool that another agent can call:

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  system: "Research topics thoroughly using web search.",
  tools: { webSearch: true },
  maxSteps: 5,
});
```

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

## Next

- [Providers](./providers.md): configure OpenAI, Anthropic, and Google
- [Middleware](./middleware.md): add auth and rate limiting to your agents

## Related

- [`veryfront/agent`](../reference/agent.md): agent API reference
- [`veryfront/workflow`](../reference/workflow.md): workflow API reference
