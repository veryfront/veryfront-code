---
title: "Deploy project"
description: "Build and deploy a Veryfront project."
order: 7
---

## Prerequisites

- A project that runs locally with `veryfront dev` (see
  [Create project](./create-project.md)).
- For Veryfront Cloud: run `veryfront login` or set `VERYFRONT_API_TOKEN`. See
  [Configuration](../guides/configuration.md).
- For another host: any container or Node-compatible runtime that can serve the
  build output.

## Build

Create a production build:

```bash
veryfront build
```

This writes the production output to `dist/`.

## Run the production build locally

Stop the dev server, then serve the production build:

```bash
veryfront serve
```

Open [http://localhost:3000](http://localhost:3000). Confirm the same pages and
endpoints work.

## Deploy to Veryfront Cloud

Create or link the cloud project, push the current source, create a release, and
deploy it:

```bash
npx veryfront deploy
```

`veryfront deploy` writes `veryfront.json` when it links a project, waits for
browser assets, and prints the environment URL.

For a preview deployment per branch:

```bash
npx veryfront deploy --branch feature-x
```

## Deploy somewhere else

For a non-Cloud target, run `veryfront build` and ship the `dist/` output. See
[Building and deploying](../guides/deploying.md).

## Verify it worked

After Deploy completes, run:

```bash
veryfront open
```

The deployed page and API routes respond.

For an automated production workflow, see
[Deploy from CI](../guides/deploy-from-ci.md).
