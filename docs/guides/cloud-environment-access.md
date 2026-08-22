---
title: "Manage Cloud environment access"
description: "Verify protected environments and make an environment public."
order: 45
---

Veryfront Cloud creates `preview`, `staging`, and `production` environments.
Each environment is protected by default. Use this guide when a browser, CI
check, or API client must reach a deployed environment.

## Check a protected environment

Open the environment URL in a browser signed in as a project member. A protected
environment serves the request when it carries that member's session in the
`authToken` cookie.

To inspect an unauthenticated response, probe a route the project serves:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  <environment-url>/<route>
```

An unauthenticated request receives a `302` sign-in redirect. The sign-in apex
depends on the host serving the environment:

- `*.veryfront.com` redirects to `https://veryfront.com/sign-in`.
- `*.preview.veryfront.org` redirects to `https://veryfront.org/sign-in`.

Sign in on the apex in `redirect_url`. The session cookie is scoped to that
domain.

## Authenticate a non-browser client

A non-browser client can still authenticate by sending the `authToken` cookie
with a project member's session token. Store that token as a secret and account
for its expiration.

`VERYFRONT_API_TOKEN` does not open a protected environment on its own. It
authenticates the CLI against the Cloud API, not requests to the deployed app.
Exchange it for an environment access token instead: a user token for the key
owner that the gate accepts for five minutes and that the Cloud API refuses as a
session. `veryfront deploy` performs this exchange to probe the environment it
deployed. A CI smoke test can do the same:

```bash
set -euo pipefail
TOKEN=$(curl -fsS -X POST https://api.veryfront.com/auth/environment-token \
  -H "Authorization: Bearer $VERYFRONT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<PROJECT_ID>","environment_name":"production"}' |
  jq -er '.access_token | strings | select(length > 0)')
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --cookie "authToken=$TOKEN" \
  <environment-url>/<route>)
[ "$STATUS" = "200" ] || { echo "expected 200, got $STATUS" >&2; exit 1; }
```

Compare against the status the route normally returns. The probe does not
follow redirects: a `302` means the gate refused the token, not that the app
answered, and the comparison turns it into a failed job. The token is bound to
the project and environment named in the exchange. A key scoped to another
project, or a key whose owner is not a member of the project gets a `403` at
the exchange.

## Make an environment public

In Veryfront Studio:

1. Open **Environments**.
2. Select the environment.
3. Enable **Public Environment**.
4. Confirm **Make Public**.

Keep protection enabled for internal or unreleased environments.

## Verify it worked

Repeat the route probe:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  <environment-url>/<route>
```

Validate the status that route normally returns. Do not require a `200` from
the environment root when the project has no static page at `/`.

See [Deployment behavior](./deploying.md) for readiness and URL semantics.
