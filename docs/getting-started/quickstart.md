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

Answer **No** to **Use Veryfront Cloud?** to follow this direct-provider
tutorial. To use Veryfront inference and inspect local runs in Studio without
a provider API key, follow the [Cloud quickstart](./cloud-quickstart.md).

## Configure inference

Set the API key in the terminal where you run Veryfront:

```bash
export OPENAI_API_KEY="<API_KEY>"
```

The starter uses `openai/gpt-5-nano`. Veryfront sends the requests directly
to OpenAI.

## Run the app

```bash
npm run dev
```

The CLI confirms the server and available inference path:

```text
✓ App ready       http://localhost:3000
  Execution       This machine
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

Continue with [Local delegation](../guides/multi-agent.md#local-delegation) when you need more than one agent.

## Next steps

- [Add tools](../guides/tools.md) to give the agent another capability.
- [Write evaluations](../guides/evals.md) to check behavior after changes.
- [Deploy with Cloud](./cloud-quickstart.md) or [Self-host the app](../guides/self-hosting.md).

[Use another inference provider](../guides/providers.md) when you need a different model or local inference.
