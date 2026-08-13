---
title: "Cloud quickstart"
description: "Run an agent through the Veryfront Cloud AI Gateway and deploy it."
order: 2
---

Build an agent app, use the Veryfront Cloud AI Gateway during local development
and evaluation, then deploy the same source to Veryfront Cloud.

## Prerequisites

- Node.js 22.3 or later.
- A Veryfront account.

You do not need a model-provider API key for this tutorial.

## Create the app

```bash
npm create veryfront@latest support-agent -- --template ai-agent
cd support-agent
```

## Sign in and link the project

```bash
npx veryfront@latest login
npx veryfront@latest push
```

Sign-in stores the CLI credential. Push creates or links the Cloud project and
prints its protected preview URL.

## Run through the AI Gateway

```bash
npm run dev
```

The CLI confirms the gateway is available:

```text
✓ Ready in 1.3s
http://localhost:3000
Inference Veryfront Cloud AI Gateway
```

## Verify the agent locally

Open the local URL printed by the CLI and ask:

```text
What is 128 divided by 8?
```

The assistant calls the calculator tool and returns `16` through the Veryfront
Cloud AI Gateway.

## Run the eval

Stop the dev server with `Ctrl+C`, then run:

```bash
npm run eval -- assistant
```

The command exits successfully after the agent calls the calculator and returns
the expected answer through the gateway.

## Deploy to production

```bash
npx veryfront@latest deploy --env production
```

Deploy uses the source from Push and prints the production environment URL.
Veryfront Cloud environments are protected by default, so open the URL in a
browser signed in as a project member.

## Verify it worked

Open the production URL that Deploy printed and ask the same calculator
question. The deployed agent returns `16` through the Veryfront Cloud AI
Gateway.

## Next steps

- [Deploy an existing project](./deploy-project.md).
- [Choose an explicit gateway model](../guides/providers.md#veryfront-cloud-ai-gateway).
- [Review deployment behavior](../guides/deploying.md).
- [Develop without Veryfront Cloud](./quickstart.md).
