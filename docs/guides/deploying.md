---
title: "Build and deploy"
description: "Take a Veryfront project from local development to production."
order: 43
---

Use this guide to build a production bundle, run it locally, and deploy it.
Keep the first production path narrow: one route, one check, one deploy.

## Prerequisites

- A Veryfront project that runs with `veryfront dev`.
- Production credentials for providers, integrations, and deployment targets.
- For Veryfront Cloud: `VERYFRONT_API_TOKEN` and a project reference.
- For self-hosting: the current Node.js LTS or a container host that can serve
  the build output.

## Pick one production path

Choose one route or API boundary to verify across every stage.

| Boundary                 | Add                                          | Verify locally                               |
| ------------------------ | -------------------------------------------- | -------------------------------------------- |
| Page                     | `app/page.tsx` or another route under `app/` | Open the route in the browser                |
| API route                | `app/api/<name>/route.ts`                    | Run `curl http://localhost:3000/api/<name>`  |
| Agent chat               | Page plus `app/api/ag-ui/route.ts`           | Send one message and confirm streamed output |
| Workflow or task trigger | API route or CLI command                     | Trigger one run and inspect the result       |

Add only the primitive that route needs now. Use
[Choose a primitive](./choose-a-primitive.md) when more than one option looks
valid.

## Build

Create a production build:

```bash
veryfront build
```

This compiles pages, bundles assets, pre-renders static routes, and writes the
output to `dist/` by default.

Customize the output directory in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  build: {
    outDir: "dist",
    trailingSlash: false,
  },
});
```

## Run the build locally

```bash
veryfront build
veryfront serve
```

Open the same route you tested in development. For API routes, compare the dev
and production responses with `curl`.

## Deploy to Veryfront Cloud

```bash
veryfront deploy
```

Deploys your project to Veryfront Cloud.

For preview deployments:

```bash
veryfront deploy --branch feature-x
```

Use `veryfront open` after deployment to open the project. Use
`veryfront open --json` when automation needs the deployed URL.

## Set production environment variables

Set provider and integration credentials on the deployment platform:

```bash
OPENAI_API_KEY=<API_KEY>
ANTHROPIC_API_KEY=<API_KEY>
```

For Veryfront Cloud, set the same variables in the target environment before
deploying.

## Deploy somewhere else

Self-hosted deployments can use the build output or a container:

```dockerfile
FROM denoland/deno:2.6.0

WORKDIR /app
COPY . .
RUN deno task build

EXPOSE 3000
CMD ["deno", "task", "start"]
```

Use infrastructure that supports your chosen runtime and can serve the build
output.

## Verify it worked

After `veryfront build`:

- `dist/` or your configured `outDir` contains compiled assets.
- `veryfront serve` serves the build locally.
- The route you chose responds the same way it did in development.

After `veryfront deploy`:

- The CLI confirms the deployed release and environment.
- `veryfront open` opens the deployed project.
- The same page, API route, agent, workflow, task, or run path works in
  production.
- The Cloud dashboard lists the deployment under the project.

## Next

- [Configuration](./configuration.md): Configure build and environment behavior
- [Providers](./providers.md): Configure model provider defaults

## Related

- [veryfront](../api-reference/veryfront/index.md): Framework entrypoint
- [veryfront/server](../api-reference/veryfront/server.md): Server runtime APIs
- [veryfront/observability](../api-reference/veryfront/observability.md): Runtime observability
