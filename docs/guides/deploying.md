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
- For Veryfront Cloud: run `veryfront login` or set `VERYFRONT_API_TOKEN`.
- For self-hosting: the current Node.js LTS or a container host that can run
  `veryfront serve` from the project directory.

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

Choose a different output directory explicitly:

```bash
veryfront build --output build-output
```

Or set it once in `veryfront.config.ts`, which `--output` overrides when both
are present:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  build: { outDir: "build-output" },
});
```

A relative `outDir` resolves against the project directory. The build clears
its output directory before writing, so point it somewhere the project does not
keep files of its own. An `outDir` that is the project directory or contains it
is rejected before the build starts.

`build.trailingSlash` remains an accepted configuration field for
compatibility, but the production builder does not consume it.

## Run the build locally

```bash
veryfront build
veryfront serve
```

Open the same route you tested in development. For API routes, compare the dev
and production responses with `curl`.

## Self-host

Veryfront Code is an Apache-2.0 open-source framework. You can deploy it to any
environment that supports your chosen JavaScript runtime, including your own
cloud account, a private network, or on-premises infrastructure. Self-hosting
does not require a Veryfront account.

To self-host Veryfront Code, ship the whole project directory, not just
`dist/`. The container below copies the project, builds it in place, and serves
it from the project directory:

```dockerfile
FROM denoland/deno:2.6.0

WORKDIR /app
COPY . .
RUN deno task build

EXPOSE 3000
CMD ["deno", "task", "start"]
```

Use infrastructure that supports your chosen runtime and can run
`veryfront serve` from the project directory.

## Preview on Veryfront Cloud

Create or link the cloud project and push the current source to its preview:

```bash
npx veryfront@latest push
```

`veryfront push` stores local project identity in ignored
`.veryfront/project.json`, records the pushed source digest in
`.veryfront/push-receipt.json`, and prints the preview URL. It does not write
`veryfront.json`.

Push preserves remote-only files by default. Use
`npx veryfront@latest push --prune --dry-run` to preview an exact remote mirror, then
run `npx veryfront@latest push --prune` only when those deletions are intentional.

Veryfront hosting serves three environment names: `preview`, `staging`, and
`production`. Only those resolve at
`https://<slug>.<environment>.veryfront.com`. Every other name, including
`development`, has no address on `veryfront.com`. An environment can still carry
any name you like once it has a custom domain attached, because routing then
follows the domain rather than the name. For a project that serves at least one
static page, deploy rejects an environment that has neither a hosted name nor a
custom domain before it creates a release, so the failure costs one API call
rather than a full deployment.

That check needs a page to probe. A project that serves only API routes or an
agent has no page address to verify, so it deploys under any environment name
and reports no hosted address for the deployment.

For an existing nonproduction environment named `staging`:

```bash
npx veryfront@latest push --branch feature-x
npx veryfront@latest deploy --branch feature-x --env staging
```

Deploy uses the last verified Push receipt and verifies the release was built
from that exact source digest before assigning it to the environment. If no Push
receipt exists, Deploy first runs a quiet Push so the first deployment still
works as one command. Deploy prints the environment URL.
`npx veryfront@latest open --site --env staging` opens that deployed environment
in a browser, and `npx veryfront@latest open --site --env staging --json` prints
its URL for automation. `--site` targets `production` unless `--env` names
another environment, so name the environment you deployed. Without `--site`, use
`npx veryfront@latest open` after deployment to open the project in the Cloud
dashboard, and `npx veryfront@latest open --json` to print that dashboard URL.

`--site` always builds the canonical
`https://<slug>.<environment>.veryfront.com` address, because `open` has no API
token with which to read the environment's configured domains. Deploy prints the
custom domain when the environment has one, so the two can differ in origin even
though both reach the same deployment. Automation that must use the custom domain
should record the URL Deploy printed rather than rebuild it from `open --site`.

`open` resolves the same project reference Push and Deploy use, including the
local `.veryfront/project.json` link. Dashboard URLs are built from the project slug,
so `open` skips an ID-only `VERYFRONT_PROJECT_ID` or `TENANT_PROJECT_ID`
reference and uses the link instead.

Project reference precedence is `VERYFRONT_PROJECT_SLUG` or environment
configuration, then `veryfront.config.ts`, then legacy `veryfront.json`, then
lower-level tenant or project-ID environment references, then the ignored local
link. Keep `.veryfront/project.json` ignored unless you intentionally use
committed configuration instead.

## Check who can reach the environment

Veryfront Cloud creates `production`, `staging`, and `preview` as protected by
default, and Deploy prints `Protected` or `Public` next to the release version.
A protected environment serves a request only when it carries a Veryfront user
session for a member of the project. A signed-in browser is the usual client,
not the only one: the session travels in an `authToken` cookie, so `curl` or a
CI smoke test reaches a protected environment by sending a project member's
session token. An API key is not a session, so `VERYFRONT_API_TOKEN` does not
open one. It authenticates the CLI against the Cloud API, not deployment
traffic. A request with no session, or one carrying a credential the gate cannot
verify, is redirected to the Veryfront sign-in page on every path including API
routes. A session belonging to a non-member gets a `403` instead.

Plan for that before a launch or an external smoke test. To make an environment
reachable by anyone with the URL, open Environments in Veryfront Studio, select
the environment, turn on **Public Environment**, and confirm **Make Public**.
See [Deploy project](../getting-started/deploy-project.md#environment-access)
for the responses a protected environment returns.

## Set production environment variables

Set provider and integration credentials on the deployment platform:

```bash
OPENAI_API_KEY=<API_KEY>
ANTHROPIC_API_KEY=<API_KEY>
```

For Veryfront Cloud, set the same variables in the target environment before
deploying.

## Verify it worked

After `veryfront build`:

- `dist/`, or the directory passed to `--output`, contains compiled assets.
- `veryfront serve` serves the build locally.
- The route you chose responds the same way it did in development.

After `veryfront deploy`:

- The CLI confirms the release, environment, and verified source digest.
- The CLI reports whether every shared proxy acknowledged the active release. An
  unconfirmed data-plane update is a warning after commit, not a failed deploy;
  do not retry solely because of that warning.
- The environment URL Deploy printed serves the deployed page and API routes.
- `veryfront open --site` reaches that deployment at its canonical
  `https://<slug>.<environment>.veryfront.com` address.
- `veryfront open` opens the project in the Cloud dashboard, not the deployed
  site.
- The same page, API route, agent, workflow, task, or run path works in
  production. Test it from a browser signed in to Veryfront while the
  environment is protected.
- The Cloud dashboard lists the deployment under the project.

## Tear a project down

`veryfront push` and `veryfront up` create a cloud project the first time they
run. Delete that project, and the environments, releases, files, and uploads it
owns, from the CLI:

```bash
veryfront project delete            # deletes the project this directory targets
veryfront project delete my-app     # deletes a project by slug
```

The command asks for confirmation. In CI, pass `--yes` to answer the prompt or
`--force` to skip it, and add `--json` for a machine-readable result. Deletion
is permanent; there is no undo.

## Next

- [Configuration](./configuration.md): Configure build and environment behavior
- [Deploy from CI](./deploy-from-ci.md): Push and deploy reviewed Git commits from CI
- [Move Studio changes into Git](./move-studio-changes-to-git.md): Review a Studio release through a Git pull request
- [Providers](./providers.md): Configure model providers

## Related

- [veryfront](../api-reference/veryfront/index.md): Framework entrypoint
- [veryfront/cli](../api-reference/veryfront/cli.md): Pull, Push, and Deploy command catalog
- [veryfront/server](../api-reference/veryfront/server.md): Server runtime APIs
- [veryfront/observability](../api-reference/veryfront/observability.md): Runtime observability
