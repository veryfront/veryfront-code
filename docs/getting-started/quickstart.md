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
