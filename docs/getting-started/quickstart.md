---
title: "Local quickstart"
description: "Build, run, and evaluate your first Veryfront agent app locally."
order: 1
---

Build a working agent app on your machine with a direct model provider. This
tutorial does not require a Veryfront account or Veryfront Cloud.

## Prerequisites

- Node.js 22.3 or later.
- An OpenAI API key for model inference.

## Create the app

```bash
npm create veryfront@latest support-agent -- --template ai-agent
cd support-agent
```

The starter contains an assistant agent, `calculator.ts` tool, chat page,
AG-UI route, and smoke eval.

## Configure inference

Set the API key in the terminal where you run Veryfront:

```bash
export OPENAI_API_KEY="<API_KEY>"
```

The starter uses `openai/gpt-5.4-nano`. Veryfront sends the requests directly
to OpenAI.

## Run the app

```bash
npm run dev
```

The CLI confirms the server and available inference path:

```text
✓ Ready in 1.3s
http://localhost:3000
Inference OpenAI direct
```

## Verify it worked

Open the local URL printed by the CLI and ask:

```text
What is 128 divided by 8?
```

The assistant calls the calculator tool and returns `16`.

## Run the eval

Stop the dev server with `Ctrl+C`, then run:

```bash
npm run eval -- assistant
```

The command exits successfully after the agent calls the calculator and returns
the expected answer.

## Add local delegation

Keep using the same provider key and project. Add a specialist that identifies
the important facts:

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  system:
    "Identify the three most important facts in the user's request. Return concise bullet points.",
  maxSteps: 3,
});
```

Add a second specialist that turns notes into a clear answer:

```ts
// agents/writer.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "writer",
  system: "Turn the supplied notes into a concise, practical answer.",
  maxSteps: 3,
});
```

Replace `agents/assistant.ts` with an orchestrator that can call both
specialists:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  name: "Assistant",
  description: "Research a request and turn it into a practical answer.",
  system:
    "Use the researcher first. Pass the researcher's notes to the writer, then return the writer's answer.",
  delegates: ["researcher", "writer"],
  maxSteps: 10,
});
```

Each delegate runs in the same Veryfront process as the assistant. The
`delegates` list exposes the specialists as `agent_researcher` and
`agent_writer` tools. It does not create hosted child runs or require a
Veryfront account.

If the development server is still running, keep using it. If you stopped the
server for the eval, start it again:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask:

```text
Compare two ways a small team could reduce support response time. Recommend one.
```

Confirm the run calls `agent_researcher` and `agent_writer`, then returns one
combined recommendation. For delegation controls and workflow-based
coordination, see [Multi-agent](../guides/multi-agent.md).

## Next steps

- [Use another inference provider](../guides/providers.md), including Anthropic,
  Google, Ollama, LM Studio, or a built-in local model.
- [Self-host the app](../guides/self-hosting.md) in your own environment.
- [Use the Veryfront Cloud AI Gateway](./cloud-quickstart.md) and deploy with
  Veryfront Cloud.
- Continue with [Create project](./create-project.md), or consult the
  [Agent](../api-reference/veryfront/agent.md),
  [Tool](../api-reference/veryfront/tool.md), and
  [Chat](../api-reference/veryfront/chat.md) references.
