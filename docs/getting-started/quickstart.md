---
title: "Quickstart"
description: "Build your first Veryfront agent app."
order: -1
---

## Prerequisites

- Node.js 18.18 or later.
- The Veryfront CLI installed. See [Installation](./installation.md).

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

## Authenticate

From the project directory, authenticate with Veryfront Cloud:

```bash
veryfront login
```

This lets the app use the Veryfront Cloud gateway for model inference. You can
also set `VERYFRONT_API_TOKEN` directly. Direct provider keys such as
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` also work; see
[Providers](../guides/providers.md).

## Run it locally

```bash
veryfront dev
```

## Verify it worked

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

The answer should stream. The curl response should emit `data:` lines.
