---
title: "Deploy with Veryfront Cloud"
description: "Push and deploy an existing Veryfront project."
order: 8
---

Deploy a project that already works locally. For a guided first project that
also uses the AI Gateway, follow the [Cloud quickstart](./cloud-quickstart.md).

## Prerequisites

- A project that works with `veryfront dev`.
- A Veryfront account.

## Sign in

```bash
veryfront login
```

For CI, set `VERYFRONT_API_TOKEN` instead. See
[Configuration](../guides/configuration.md).

## Push a preview

```bash
npx veryfront@latest push
```

Push creates or links the Cloud project, uploads the current source, and prints
the protected preview URL. Open that URL in a browser signed in as a project
member and verify the route you plan to deploy.

## Deploy to production

```bash
npx veryfront@latest deploy --env production
```

Deploy prints the environment URL after it uses the source from Push.

## Verify it worked

Open the URL Deploy printed in a browser signed in as a project member. Confirm
the same page, API route, or agent behavior you checked in the preview.

If you did not record the URL, open the deployed site with:

```bash
veryfront open --site
```

`veryfront open` opens the project in the Cloud dashboard. It does not open the
deployed site.

Veryfront Cloud environments are protected by default. An unauthenticated
request is redirected to sign-in, and `VERYFRONT_API_TOKEN` does not open a
protected environment. To make the environment public, open **Environments** in
Veryfront Studio, select the environment, enable **Public Environment**, and
confirm **Make Public**.

See [Cloud environment access](../guides/cloud-environment-access.md) for
authenticated requests and status codes. See
[Deployment behavior](../guides/deploying.md) for Push, Deploy, project-link,
and URL details.
