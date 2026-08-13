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

## Self-host

Veryfront Code is open source and can run in your own cloud, private network,
or on-premises environment. Self-hosting does not require a Veryfront account.

To self-host Veryfront Code, ship the whole project directory, not just
`dist/`. Copy the project to the host and run `veryfront build` there (or ship the `dist/` you built locally
alongside the source), then run `veryfront serve` from the project directory.

A host that receives only `dist/` has no backend. The pages load, but every API
route is absent, and the response depends on the host: running
`veryfront serve` over a `dist/`-only directory returns 404, while a static host
that honors the generated `_redirects` file returns the SPA `index.html` with a
200. Either way the chat UI from the default scaffold loads with a dead
`/api/ag-ui` backend. See [Building and deploying](../guides/deploying.md) for a
container example.

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

## Environment access

Veryfront Cloud creates `preview`, `staging`, and `production` as protected by
default, so check the preview URL in a browser signed in to Veryfront as a
member of the project.

A protected environment serves only requests that carry a Veryfront user
session for a member of the project. That session travels in an `authToken`
cookie, which a browser receives by signing in. A request without one gets a
`302` to a Veryfront sign-in page, on every path including API routes:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://<project>.production.veryfront.com/api/health
```

```text
302 https://veryfront.com/sign-in?from=https%3A%2F%2F...%2Fapi%2Fhealth
```

Which sign-in apex you get depends on the host serving the environment, so read
it out of the printed `redirect_url` instead of assuming one. A
`*.veryfront.com` environment signs in at `https://veryfront.com/sign-in`, while
a preview host on `*.preview.veryfront.org` signs in at
`https://veryfront.org/sign-in`. The apex matters because a session cookie is
scoped to the domain that issued it: sign in on the wrong apex and the
deployment host never receives the cookie, so the redirect just repeats.

A request signed in as a user who is not a member of the project gets a `403`
instead. A `403` means the account is wrong, not the URL.

`VERYFRONT_API_TOKEN` carrying an API key (a `vf_` key) does not open a
protected environment. It authenticates the CLI against the Cloud API, not
deployment traffic. The environment gate reads a user id out of a verified
session token and has no API-key branch, so an API key presented to it resolves
to no user and draws the same sign-in redirect an anonymous request gets.
`veryfront deploy` acts on that distinction instead of leaking the key: it sends
the stored credential to a protected environment only when that credential is a
session token, and otherwise probes anonymously and accepts the challenge as
proof the environment is serving. Its readiness probe counts a sign-in redirect,
a `401`, and a `403` alike as that challenge.

A non-browser client can still authenticate. The gate inspects the cookie, not
the client, so `curl`, a CI smoke test, or an uptime monitor reaches a protected
environment by sending the `authToken` cookie with the session token of a
project member. That token is a member's own session, so it expires and belongs
in a secret store rather than a checked-in workflow file. For an unattended
check with no session to spend, make the environment public instead.

To serve an environment to everyone, open **Environments** in Veryfront Studio,
select the environment, turn on **Public Environment**, and confirm
**Make Public**. Keep protection on for environments that serve internal or
unreleased work.

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

## Verify it worked

Deploy prints the environment URL. Probe a route your project actually serves,
and print the status line so a sign-in redirect is visible instead of passing
silently:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <environment-url>/<route>
```

Validate the status that route is expected to return, rather than expecting a
`200` from the environment root. The root answers `200` only when the project
has a static page route at `/`. A deployment whose routes are all API routes, or
whose only pages are dynamic like `/blog/[slug]`, has no root page to answer
with, so probe one of its API routes and check that route's own status. Deploy
draws the same line: it picks a readiness route only from the project's static
page routes and skips the browser readiness probe entirely when there is none,
so a successful deploy does not imply a `200` anywhere.

A protected environment answers `302` to the sign-in page (see
[Environment access](#environment-access) for which apex serves it) or `403`
for a signed-in non-member. In that case open the URL in a member's browser,
repeat the request with a member's session in an `authToken` cookie, or make the
environment public. Do not check with a bare
`curl -sSf <environment-url>`: `curl` does not treat a `302` as a failure, so
that command exits `0` with an empty body whether or not the deployment works.

Once the environment is public, request an API route the project serves. For
the agent route from [Create API](./create-api.md):

```bash
curl -sSf -N -X POST <environment-url>/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

If you did not record the URL Deploy printed, `veryfront open --site` opens the
deployed site, and `veryfront open --site --json` prints that URL for scripts:

```bash
veryfront open --site --json
```

```json
{ "success": true, "command": "open", "data": { "url": "https://<slug>.production.veryfront.com" } }
```

Without `--site`, `veryfront open` opens the project in the Cloud dashboard,
where the deployment is listed, and `veryfront open --env production` opens the
project's Environments panel. Neither opens the deployed site.

For an automated production workflow, see
[Deploy from CI](../guides/deploy-from-ci.md).
