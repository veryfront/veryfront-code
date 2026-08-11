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
- For another host: any container or Node-compatible runtime that can run
  `veryfront serve` from the project directory.

## Build

Create a production build:

```bash
veryfront build
```

This writes the browser build to `dist/`: HTML, client bundles, CSS, and static
assets. API routes, agents, workflows, and tasks are not compiled into `dist/`.
`veryfront serve` loads them from the project source at request time.

## Run the production build locally

Stop the dev server, then serve the production build:

```bash
veryfront serve
```

Open [http://localhost:3000](http://localhost:3000). Confirm the same pages and
endpoints work.

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

For a preview deployment per branch:

```bash
npx veryfront@latest push --branch feature-x
```

## Deploy to Veryfront Cloud

After checking the preview, deploy the exact pushed source digest:

```bash
npx veryfront@latest deploy --env production
```

Deploy uses the last verified Push receipt, verifies the release source digest,
waits for browser assets, and prints the environment URL. If no Push receipt
exists, Deploy first runs a quiet Push so a first deployment still works as one
command.

Project reference precedence is `VERYFRONT_PROJECT_SLUG` or environment
configuration, then `veryfront.config.ts`, then legacy `veryfront.json`, then
lower-level tenant or project-ID environment references, then the ignored local
link.

## Deploy somewhere else

For a non-Cloud target, ship the whole project directory, not just `dist/`. Copy
the project to the host and run `veryfront build` there (or ship the `dist/` you
built locally alongside the source), then run `veryfront serve` from the project
directory.

A host that receives only `dist/` has no backend. The pages load, but every API
route is absent, and the response depends on the host: running
`veryfront serve` over a `dist/`-only directory returns 404, while a static host
that honors the generated `_redirects` file returns the SPA `index.html` with a
200. Either way the chat UI from the default scaffold loads with a dead
`/api/ag-ui` backend. See [Building and deploying](../guides/deploying.md) for a
container example.

## Verify it worked

Deploy prints the environment URL. Request that URL and confirm the deployed
page responds:

```bash
curl -sSf <environment-url>
```

Then request an API route the project serves. For the agent route from
[Create API](./create-api.md):

```bash
curl -sSf -N -X POST <environment-url>/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

`veryfront open` opens the project in the Cloud dashboard, where the deployment
is listed; `veryfront open --env production` opens that environment's dashboard
page. Neither opens the deployed site, so use the environment URL Deploy printed
to check the running deployment.

For an automated production workflow, see
[Deploy from CI](../guides/deploy-from-ci.md).
