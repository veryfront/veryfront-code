---
title: "Recover integration connections"
description: "Handle denied consent, expired handoffs, expired or revoked connections, and changed connection generations without replaying writes."
order: 54
---

Use this guide when an integration call or connect operation does not succeed.
Each case lists the signal you receive, whether the provider request ran, and
the next step. The examples use Gmail; every OAuth connector behaves the same
way.

Two rules apply to every case:

- **Wait with a deadline.** Never poll without a limit. Stop at the deadline and
  start a new connect operation instead of extending the wait.
- **Never replay a write automatically.** Call again only when the failure says
  no provider request was sent. When the outcome is unknown, inspect the
  provider first.

## Consent was denied or cancelled

**Signal:** The provider returns the person to Veryfront with an error. The
OAuth callback redirects to your return address with `oauth_error=access_denied`
and `integration=gmail`. Other provider errors arrive as
`oauth_error=provider_error`. When the person closes the consent window
instead, nothing arrives.

**Effect:** No connection is created or changed. Connection inventory stays as
it was.

**Next step:** Ask the person whether they want to connect. Start a new connect
operation only if they do. `veryfront integration connect` fails immediately with
`integration-consent-denied` after a denial, without polling. When nothing
arrives, it stops at `--timeout` seconds (default 300, maximum 3600) with
`integration-connect-unconfirmed`. Press Ctrl+C to cancel sooner.

## The connect handoff expired

**Signal:** Opening the connect URL returns HTTP 400 with
`Invalid or expired OAuth connect session`.

**Effect:** No provider consent started, and inventory is unchanged.

**Why:** `POST /oauth/connect/session` returns a one-time `connect_url` and an
`expires_at` deadline 120 seconds away. The URL works once. The deadline covers
opening the URL, not the time the person spends on the provider's consent
screen.

**Next step:** Start a new connect operation and open its URL before
`expires_at`. The CLI checks the deadline before it opens the browser.

## Wait for a new connection

Confirm a new connection from inventory. Record the connections you already
had, start the handoff, show its one-time URL to the person, then poll at a
fixed interval and stop at a deadline you choose before you start. The redirect
URI is where the browser returns after consent, such as your application's
integration page:

```ts
import { createIntegrationClient, type IntegrationClientConnection } from "veryfront/integrations";

const client = await createIntegrationClient({
  apiBaseUrl: "<API_BASE_URL>",
  authToken: "<TOKEN>",
  projectReference: "<PROJECT_SLUG>",
});

async function presentConnectUrl(url: string, expiresAt: string): Promise<void> {
  // Show the link to the signed-in person in your UI until expiresAt.
  // The URL carries a one-time handoff token: never log it.
  void url;
  void expiresAt;
}

async function connectedRows(): Promise<IntegrationClientConnection[]> {
  const rows: IntegrationClientConnection[] = [];
  for await (const row of client.listConnections("gmail")) {
    if (row.status === "connected") rows.push(row);
  }
  return rows;
}

const known = new Set(
  (await connectedRows()).map((row) => `${row.id}:${row.connection_generation_id}`),
);
const handoff = await client.connect("gmail", { redirectUri: "<REDIRECT_URI>" });
if (handoff.status !== "oauth_handoff") throw new Error(`Gmail needs setup: ${handoff.status}`);
await presentConnectUrl(handoff.connect_url, handoff.expires_at);

const deadline = Date.now() + 5 * 60 * 1000;
let observed: IntegrationClientConnection | undefined;
while (!observed && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  observed = (await connectedRows()).find((row) =>
    !known.has(`${row.id}:${row.connection_generation_id}`)
  );
}
if (!observed) {
  throw new Error("No new Gmail connection before the deadline. Start a new connect operation.");
}
console.log(observed.id, observed.scope);
```

A new `connection_generation_id` on an existing `id` means the same account was
reconnected. `veryfront integration connect` performs the same check for you and
returns `connection_observed` with the confirmed row. If the callback arrives
but inventory does not show a new generation within its short confirmation
window, it returns `integration-connect-unconfirmed`. Inspect
`veryfront integration connections gmail` before calling a tool.

## The connection expired or was revoked

**Signal:** The call returns a tool result with `isError: true`,
`structuredContent.error` set to `reconnect_required`, and a `connectUrl`.
Inventory can show the row as `expired`, or as `disconnected` after a disconnect.
The same code is returned when the provider rejects the stored grant, for
example after the person revoked access in their provider account settings.

**Effect:** No provider data changed. Veryfront does not fall back to another
account, even when the project has one.

**Next step:** Reconnect the same account in the same scope, for example
`veryfront integration connect gmail --project "<PROJECT_SLUG>" --scope project`
for a shared connection.
The reconnect issues a new `connection_generation_id`. Read inventory again,
update any generation you pinned, and call once.

## The connection generation changed

**Signal:** A call with `expected_connection_generation_id` (REST and MCP
`_meta`), `expectedConnectionGenerationId` (GraphQL and TypeScript), or
`--expected-generation` (CLI) fails with `validation-failed` and the detail
`Selected connection generation changed`:

| Surface    | Where the failure appears                                                        |
| ---------- | -------------------------------------------------------------------------------- |
| REST       | HTTP 400 problem with `slug: "validation-failed"`                                |
| GraphQL    | `errors[0].extensions.slug` is `validation-failed`, `data` is `null`             |
| MCP        | `isError: true` with `_meta.condition.slug` set to `validation-failed`           |
| TypeScript | `IntegrationApiError` with `httpStatus === 400` and `outcomeUnknown === false`   |
| CLI        | `error.registrySlug` is `validation-failed`; `context.outcomeUnknown` is `false` |

Readiness for the same selection reports `selection.state: "stale"` and the
blocker `connection_stale`.

**Effect:** The API rejected the call before reading credentials. No provider
request was sent.

**Next step:** Read inventory again. Confirm that the row with the same `id` is
still the account you intend to use, then call once with its new generation. Do
not select a different account to make the call succeed.

## The selected connection is not available

**Signal:** A call with `connection_id` fails with `validation-failed` and the
detail `Selected connection is not available for this project, integration, and
caller`.

**Effect:** No provider request was sent, and Veryfront did not substitute
another account.

**Next step:** List the project's connections with the same credential and
select a row from that response.

## The provider outcome is unknown

**Signal:** A write tool returns `structuredContent.error` set to
`execution_outcome_unknown`, the TypeScript client throws `IntegrationApiError`
with `outcomeUnknown === true`, or the CLI envelope reports
`outcomeUnknown: true`.

**Effect:** The provider may have completed the write.

**Next step:** Check the provider for the result before you repeat anything.
The TypeScript client and the CLI never replay the call. Read-only tools report
`execution_failed` instead, which you can retry once the provider recovers.

## Verify it worked

1. Inventory shows the intended row with `status: "connected"` and the
   `connection_generation_id` you plan to pin.
2. Readiness for that selection reports `selection.state: "selected"` and
   `local_eligibility.state: "eligible"`.
3. One read-only call, such as `gmail__list_emails`, returns a result with
   `isError` unset or `false`.

## Related

- [Integrations](../integrations.md): make a first call on each surface.
- [Integration credentials and scopes](./credentials.md): platform and provider
  credentials, scopes, and non-OAuth setup.
- [veryfront/integrations](../../api-reference/veryfront/integrations.md): client types.
