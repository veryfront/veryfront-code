---
title: "Deploy project"
description: "Build a Veryfront project for production and ship it to Veryfront Cloud or another host."
order: 7
---

Build a Veryfront project for production and ship it. This is the final step in
the Getting Started flow.

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

This compiles pages, bundles assets, pre-renders static routes, and writes the
output to `dist/`.

## Run the production build locally

Stop the dev server, then start the production server:

```bash
veryfront start
```

Open [http://localhost:3000](http://localhost:3000). Confirm the same pages and
endpoints that worked in dev also work here.

## Deploy to Veryfront Cloud

```bash
veryfront deploy
```

Use `veryfront open` to open the deployed project in a browser.

For a preview deployment per branch:

```bash
veryfront deploy --branch feature-x
```

Use `veryfront open --branch feature-x` to open the preview.

## Deploy somewhere else

For a non-Cloud target, run `veryfront build` and ship the `dist/` output. See
[Building and deploying](../guides/deploying.md) for Docker and static export.

## Verify it worked

After `veryfront deploy`:

- The CLI confirms the deployed release and environment.
- `veryfront open` opens the deployed project in a browser.
- Use `veryfront open --json` when you need the deployed URL in a script.
- The home page and any API routes respond on the deployed host.
- The Veryfront Cloud dashboard lists the new deployment under the project.

## Next

- [Configuration](../guides/configuration.md): set runtime and build options
- [Building and deploying](../guides/deploying.md): production-build internals,
  static export, Docker

## Related

- [`veryfront` (root)](../api-reference/veryfront/index.md): `defineConfig`,
  build options
- [`veryfront/server`](../api-reference/veryfront/server.md): production server
  APIs
- [`veryfront/observability`](../api-reference/veryfront/observability.md):
  tracing, metrics, runtime logs
