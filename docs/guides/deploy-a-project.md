---
title: "Deploy a project"
description: "Build a Veryfront project for production and ship it to Veryfront Cloud or another host."
order: 6
---

Build a Veryfront project for production and ship it to Veryfront Cloud or another host. This is the final step in the Getting Started flow.

## Prerequisites

- A project that runs locally with `veryfront dev` (see [Create a project](./create-a-project.md)).
- For Veryfront Cloud: a `VERYFRONT_API_TOKEN` and a project reference. Run `veryfront login` interactively or set the env vars (see [Configuration](./configuration.md)).
- For another host: any container or Node-compatible runtime that can serve the build output.

## Build

Create a production build:

```bash
veryfront build
```

This compiles pages, bundles assets, pre-renders static routes, and writes the output to `dist/` (configurable via `build.outDir`).

## Run the production build locally

Stop the dev server, then start the production server:

```bash
veryfront start
```

Open [http://localhost:3000](http://localhost:3000). The production server serves pre-built assets, handles API routes, and renders dynamic pages on demand. Confirm the same pages and endpoints that worked in dev also work here.

## Deploy to Veryfront Cloud

```bash
veryfront deploy
```

Your site is live at `https://<slug>.production.veryfront.com`. Use `veryfront open` to open the deployed project in a browser.

For a preview deployment per branch:

```bash
veryfront deploy --branch feature-x
```

The preview is reachable at `https://<slug>--feature-x.preview.veryfront.com`.

## Deploy somewhere else

For a non-Cloud target, run `veryfront build` and ship the `dist/` output. A typical Dockerfile:

```dockerfile
FROM denoland/deno:2.6.0

WORKDIR /app
COPY . .
RUN deno task build

EXPOSE 3000
CMD ["deno", "task", "start"]
```

The same build output runs on any host that supports your chosen runtime.

## Verify it worked

After `veryfront deploy`:

- The CLI confirms the deployed release and environment.
- `veryfront open` opens the deployed project in a browser.
- Use `veryfront open --json` when you need the deployed URL in a script.
- The home page and any API routes respond on the deployed host.
- The Veryfront Cloud dashboard lists the new deployment under the project.

## Next

- [Configuration](./configuration.md): set runtime and build options
- [Building and deploying](./deploying.md): production-build internals, static export, Docker

## Related

- [`veryfront` (root)](../reference/veryfront/index.md): `defineConfig`, build options
- [`veryfront/server`](../reference/veryfront/server.md): production server APIs
- [`veryfront/observability`](../reference/veryfront/observability.md): tracing, metrics, runtime logs
