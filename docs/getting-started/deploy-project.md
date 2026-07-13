---
title: "Deploy project"
description: "Build and deploy a Veryfront project."
order: 7
---

## Prerequisites

- A project that runs locally with `veryfront dev` (see
  [Create project](./create-project.md)).
- For Veryfront Cloud: a `VERYFRONT_API_TOKEN` and a project reference. Run
  `veryfront login` or set the env vars. See
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

Push the current checkout to Veryfront `main`, then create and deploy its
release:

```bash
veryfront push --branch main --yes
veryfront deploy --branch main --env production --yes
```

Run both commands from the same checkout. Deploy verifies the Push receipt,
Git commit, and source digest before it creates the release.

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
