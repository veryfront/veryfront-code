---
title: "Building and deploying"
description: "Production builds, static export, and deployment targets."
order: 43
---

Build a Veryfront project for production with `veryfront build`, run the production server locally with `veryfront start`, then ship the build with `veryfront deploy` (Veryfront Cloud) or to any host that can run your chosen runtime.

The npm package, CLI, and import name are all `veryfront` across dev and production.

## Prerequisites

- A Veryfront project that runs with `veryfront dev`.
- Production credentials for any LLM providers and other integrations the
  app uses.
- For Veryfront Cloud: a `VERYFRONT_API_TOKEN` and a project reference.
- For self-hosted: a deploy target (container host, Node host, or static
  host) that can serve the build output.

## Build

Create a production build:

```bash
veryfront build
```

This compiles pages, bundles assets, pre-renders static routes, and outputs everything to the `dist/` directory (configurable via `build.outDir`).

## Start

Run the production server:

```bash
veryfront build
veryfront start
```

The production server serves pre-built assets, handles API routes, and renders dynamic pages on demand.

## Deploy to Veryfront Cloud

```bash
veryfront deploy
```

Deploys your project to Veryfront Cloud, the recommended managed deployment path. Your site is available at `https://<slug>.production.veryfront.com`.

### Preview deployments

Every branch gets a preview URL:

```bash
veryfront deploy --branch feature-x
```

Available at `https://<slug>--feature-x.preview.veryfront.com`.

## Environment variables

Set production environment variables on your deployment platform. At minimum, set your LLM provider keys:

```
OPENAI_API_KEY=<API_KEY>
ANTHROPIC_API_KEY=<API_KEY>
```

For Veryfront Cloud, set the same variables in the target environment before deploying.

## Build configuration

Customize the build in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  build: {
    outDir: "dist", // Output directory
    trailingSlash: false, // URL trailing slashes
  },
});
```

## Docker

For self-hosted deployments:

```dockerfile
FROM denoland/deno:2.6.0

WORKDIR /app
COPY . .
RUN deno task build

EXPOSE 3000
CMD ["deno", "task", "start"]
```

You can also deploy the same build output on other infrastructure that supports your chosen runtime or container model.

## Verify it worked

After `veryfront build`:

- `dist/` (or your configured `outDir`) contains compiled assets.
- `veryfront start` serves the build locally on port `3000`. Hit `/` and
  any API route with `curl` and confirm responses match the dev server.

After `veryfront deploy`:

- The CLI confirms the deployed release and environment.
- Run `veryfront open` to open the deployed project in a browser.
- Use `veryfront open --json` when you need the deployed URL in terminal
  output or automation.
- Confirm the home page and any API routes respond on the deployed host.
- The Cloud dashboard lists the new deployment under the project.

## Next

- [Head and SEO](./head-and-seo.md): optimize for search engines
- [Configuration](./configuration.md): all configuration options

## Related

- [`veryfront` (root)](../api-reference/veryfront/index.md): `defineConfig`, build options
- [`veryfront/server`](../api-reference/veryfront/server.md): production server APIs
- [`veryfront/observability`](../api-reference/veryfront/observability.md): tracing, metrics, and runtime logs
- [`veryfront/utils`](../api-reference/veryfront/utils.md): runtime constants and logging helpers
