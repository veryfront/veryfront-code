---
title: "Building & Deploying"
description: "Production builds, static export, and deployment targets."
order: 17
---

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

Deploys your project to Veryfront Cloud. Your site is available at `https://<slug>.veryfront.com`.

### Preview deployments

Every branch gets a preview URL:

```bash
veryfront deploy --branch feature-x
```

Available at `https://<slug>-feature-x.preview.veryfront.com`.

## Environment variables

Set production environment variables on your deployment platform. At minimum, set your LLM provider keys:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

For Veryfront Cloud:

```bash
veryfront env set OPENAI_API_KEY sk-...
```

## Build configuration

Customize the build in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  build: {
    outDir: "dist",          // Output directory
    trailingSlash: false,    // URL trailing slashes
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

## Next

- [Head & SEO](./head-and-seo.md) — optimize for search engines
- [Configuration](./configuration.md) — all configuration options

## Related

- [`veryfront` (root)](../reference/root.md) — `defineConfig`, build options
