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

Your **local project** contains the files and code on your machine. A **cloud
project** provides Veryfront services and stores runs and events. Linking them
keeps code execution local while using the cloud project's services.

## Create the app

```bash
npm create veryfront@latest support-agent -- --template ai-agent
cd support-agent
```

## Select a cloud project

During scaffolding, answer **Yes** to **Use Veryfront Cloud?** Then choose a
new or existing cloud project by selecting **Create a new cloud project** or
**Use an existing cloud project**. Follow the browser sign-in prompt when needed.
Answer **No** to continue with the local project. You can link a cloud project
when you run `npm run dev`.

The link to the cloud project is saved in `veryfront.json` without credentials.
Commit that file so teammates can reuse the cloud project after cloning. Each
teammate signs in with their own account.

A local project pulled from Studio is already linked to its cloud project:

```bash
npx veryfront@latest pull <PROJECT_SLUG>
```

## Run through the AI Gateway

```bash
npm run dev
```

The CLI prints the selected cloud project, shared cloud environment, local runtime and
service URLs. The default environment is `preview`. To select another existing
environment, run:

```bash
npm run dev -- --env production
```

Application code executes on your machine. Inference and run records use the
selected Veryfront services. Local edits take effect without pushing source.
The environment's application data and quotas are shared with other members.

## Verify the agent locally

Open the local URL printed by the CLI, `http://localhost:3000` by default, and ask:

```text
What is 128 divided by 8?
```

The assistant calls the calculator tool and returns `16` through the Veryfront
Cloud AI Gateway.

## Inspect a run

Open the Studio link printed beside the run ID in your terminal. Studio shows
the run status, output and events. The terminal and Studio use the same run ID.
Application logs remain visible in the development terminal.

## Run the eval

Stop the dev server with `Ctrl+C`, then run:

```bash
npm run eval -- assistant
```

The command exits successfully after the agent calls the calculator and returns
the expected answer through the gateway.

## Deploy to production

Publish your local source before deploying:

```bash
npx veryfront@latest push
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
