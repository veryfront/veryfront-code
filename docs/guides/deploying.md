---
title: "Building and deploying"
description: "Production builds, static export, and deployment targets."
order: 33
---

# Building and deploying

Production builds, static export, and deployment targets.

Veryfront Cloud is the primary managed deployment path. The same runtime can also be self-hosted or deployed on other infrastructure.
The npm package, CLI, and import name remain `veryfront`.

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

- The CLI prints a production URL such as
  `https://<slug>.production.veryfront.com`.
- Open the URL and confirm the home page and any API routes respond.
- The Cloud dashboard lists the new deployment under the project.

## Next

- [Head and SEO](./head-and-seo.md): optimize for search engines
- [Configuration](./configuration.md): all configuration options

## Related

- [`veryfront` (root)](../reference/root.md): `defineConfig`, build options
