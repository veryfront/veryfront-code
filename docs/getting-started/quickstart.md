---
title: "Quickstart"
description: "Scaffold, run, and test a streaming Veryfront agent app."
order: -1
---

## Prerequisites

- Node.js 18.18 or later.
- The Veryfront CLI installed. See [Installation](./installation.md).
- A model provider key for local inference. Use a placeholder in examples and
  put the real value in your local `.env` file.

## Create the app

```bash
veryfront init support-agent --template ai-agent
cd support-agent
```

The `ai-agent` template creates a runnable chat app:

```text
support-agent/
  agents/
    assistant.ts
  tools/
    calculator.ts
  app/
    page.tsx
    api/
      ag-ui/
        route.ts
```

The template includes the agent, calculator tool, chat page, and AG-UI route.

## Configure a provider

Create `.env`:

```bash
OPENAI_API_KEY=<API_KEY>
```

For local models or explicit provider routing, see [Providers](../guides/providers.md).

## Run it locally

```bash
veryfront dev
```

Open `http://localhost:3000` and ask:

```text
What is 128 divided by 8?
```

To test the route without the UI:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is 128 divided by 8?"}]}]}'
```

## Verify it worked

The browser should show a streamed assistant response that uses the calculator
tool. The curl response should emit `data:` lines as the answer is produced.

If the route returns `Agent not found`, ensure `agents/assistant.ts` is in the
project root. If the model skips the tool, ensure `tools: true` and `maxSteps`
are still set in `agents/assistant.ts`.

## Build

Build the project before deploying:

```bash
veryfront build
```

## Next

Continue with [Create project](./create-project.md).

## Related

- [`veryfront/agent`](../api-reference/veryfront/agent.md): agent API reference
- [`veryfront/tool`](../api-reference/veryfront/tool.md): tool API reference
- [`veryfront/chat`](../api-reference/veryfront/chat.md): chat API reference
