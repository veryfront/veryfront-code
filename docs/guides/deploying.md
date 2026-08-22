---
title: "Manage Cloud deployments"
description: "Control source, environments, access, and verification for Veryfront Cloud deployments."
order: 44
---

Use this guide after the first successful deployment when you need explicit
control over the source and environment that Veryfront Cloud serves.

## Prerequisites

- A project that works with `veryfront dev`.
- A Veryfront login or `VERYFRONT_API_TOKEN`.
- A page, API route, or agent request that you can verify after deployment.

For a first deployment, use [Deploy with Veryfront Cloud](../getting-started/deploy-project.md).
For your own infrastructure, use [Self-host Veryfront Code](./self-hosting.md).

## Pick one deployment boundary

Choose one behavior to check in development, preview, and production:

| Boundary         | Local check                                  |
| ---------------- | -------------------------------------------- |
| Page             | Open the route in the browser                |
| API route        | Request the route with `curl`                |
| Agent chat       | Send one message and confirm streamed output |
| Workflow or task | Trigger one run and inspect the result       |

## Build and serve locally

```bash
veryfront build
veryfront serve
```

`veryfront build` writes browser assets to `build.outDir`, which defaults to
`dist/`. API routes, agents, workflows, and tasks remain in the project source
and are loaded by `veryfront serve`.

Before uploading source, verify that `build.outDir` contains the browser assets
and that server-executed API routes, agents, workflows, and tasks remain in the
project source.

## Keep release browser artifacts together

Each production build writes a content-addressed hydration runtime beside the
release's router and other browser assets. When Veryfront renders an immutable
release, the HTML references that release-baked runtime. It does not substitute
the runtime from the currently serving Veryfront process.

This pairing is a compatibility boundary. Keep the hydration runtime for as
long as its immutable release can be deployed or served. Retire the release and
its browser artifacts together; never delete only the hydration runtime or
redirect its hashed URL to newer bytes. A release that is missing its single
versioned runtime fails rendering instead of falling back to a potentially
incompatible runtime.

Veryfront's required browser regression job exercises the current server
against an aged release artifact set. The build contract test also verifies
that every promoted artifact set contains exactly one discoverable versioned
hydration runtime, so an incompatible pairing blocks promotion in CI.

This policy follows [incident #264](https://github.com/veryfront/veryfront-issue-inbox/issues/264)
and the immediate compatibility fix in
[veryfront-code PR #3124](https://github.com/veryfront/veryfront-code/pull/3124).

## Push a preview

```bash
npx veryfront@latest push
```

Push creates or links the Cloud project, uploads the current source, and prints
the preview URL. It stores project identity in ignored
`.veryfront/project.json` and the source digest in
`.veryfront/push-receipt.json`. It does not write `veryfront.json`.

Push preserves remote-only files by default. Preview an exact mirror before
removing them:

```bash
npx veryfront@latest push --prune --dry-run
```

Apply the mirror only when those deletions are intentional:

```bash
npx veryfront@latest push --prune
```

## Deploy an environment

```bash
npx veryfront@latest deploy --env production
```

Deploy uses the last verified Push receipt, confirms the release source digest,
and prints the environment URL. If the receipt is missing, Deploy first runs a
quiet Push.

For a named nonproduction environment:

```bash
npx veryfront@latest push --branch feature-x
npx veryfront@latest deploy --branch feature-x --env staging
```

## Resolve project identity

Project references use this precedence:

1. `VERYFRONT_PROJECT_SLUG` or environment configuration.
2. `veryfront.config.ts`.
3. Legacy `veryfront.json`.
4. Tenant or project ID environment references.
5. The ignored `.veryfront/project.json` link.

Keep `.veryfront/project.json` ignored unless the project intentionally uses
committed configuration.

## Check environment access

Veryfront Cloud environments are protected by default. Open a protected URL in
a browser signed in as a project member. To make an environment public, enable
**Public Environment** in Veryfront Studio.

See [Cloud environment access](./cloud-environment-access.md) for sign-in
redirects, non-browser clients, API-token behavior, and public access.

## Recover environment URLs

Deploy prints the environment URL. To reopen the canonical site URL:

```bash
npx veryfront@latest open --site --env production
```

For automation:

```bash
npx veryfront@latest open --site --env production --json
```

`veryfront open` opens the project in the Cloud dashboard, not the deployed
site. `open --site` constructs the canonical Veryfront domain and cannot
discover a configured custom domain. Record the URL Deploy printed when
automation must use the custom domain.

## Understand readiness checks

Deploy chooses a readiness route only from static page routes. An API-only
project or a project with only dynamic pages can deploy successfully without a
root page returning `200`; Deploy skips the browser readiness probe when there
is no static route to check.

An acknowledged release can still report a data-plane warning after commit. Do
not retry only because a shared proxy acknowledgment is delayed.

## Verify it worked

Use the environment URL that Deploy printed and repeat the check from
development and preview. Validate the status or behavior that the selected
route normally returns.

For a protected environment, Deploy already probes the URL with an environment
access token obtained by exchanging your API key and prints a warning when only
the access gate answered. Repeat the check in a browser signed in as a project
member, or exchange the token yourself as described in
[Cloud environment access](./cloud-environment-access.md). For a public agent
route:

```bash
curl -sSf -N -X POST <environment-url>/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Reply in one sentence."}]}]}'
```

The response emits AG-UI `data:` lines.

## Tear a project down

Delete the project and its environments, releases, files, and uploads:

```bash
veryfront project delete
```

Use [Deploy from CI](./deploy-from-ci.md) for reviewed Git commits and protected
production environments.
