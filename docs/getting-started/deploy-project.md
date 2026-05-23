---
title: "Deploy project"
description: "Build a Veryfront project for production and ship it to Veryfront Cloud or another host."
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

Stop the dev server, then start the production server:

```bash
veryfront start
```

Open [http://localhost:3000](http://localhost:3000). Confirm the same pages and
endpoints work.

## Deploy to Veryfront Cloud

```bash
veryfront deploy
```

For a preview deployment per branch:

```bash
veryfront deploy --branch feature-x
```

## Deploy somewhere else

For a non-Cloud target, run `veryfront build` and ship the `dist/` output. See
[Building and deploying](../guides/deploying.md).

## Verify it worked

After `veryfront deploy`, run:

```bash
veryfront open
```

The deployed page and API routes should respond.
