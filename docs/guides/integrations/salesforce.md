---
title: "Set up Salesforce"
description: "Install and connect the Veryfront Salesforce integration with per-user OAuth or a service account."
order: 50
---

Use this guide to connect a Salesforce org to Veryfront. Choose per-user OAuth
when each action must use an individual's Salesforce access. Choose a service
account for scheduled or project-owned automation.

## Prerequisites

- A Salesforce administrator for the target org.
- A Veryfront project with Salesforce tools declared in an agent.
- The hosted Veryfront API for per-user OAuth, which supplies the Salesforce
  provider adapter. The generic runtime does not scaffold Salesforce OAuth
  routes. An embedding host that supplies its own Salesforce adapter must declare
  `VERYFRONT_HOST_ADAPTER_INTEGRATIONS=salesforce` to expose the connector
  catalog. This does not enable generic Salesforce scaffolding.
- For account-free local service-account execution, a Veryfront Code project
  and Salesforce service-account credentials in its environment.

## Connect a Salesforce user

Install the **Veryfront Salesforce Integration** package in each Salesforce
org that users connect to Veryfront. Salesforce External Client Apps are scoped
to an org. Without the installed package, Salesforce rejects a cross-org
authorization request.

1. Sign in to the Salesforce org as an administrator.
2. Open the [Veryfront Salesforce Integration beta installation page](https://login.salesforce.com/packaging/installPackage.apexp?p0=04tfj000000RX37AAG).
3. Select **Install for Admins Only** and acknowledge that the application is not distributed through AppExchange.
4. Wait for the installation to complete.
5. In Salesforce Setup, open **External Client App Manager** and select **Veryfront**.
6. Confirm that the app is **Packaged (Installed)** and **Enabled**.
7. Under **Policies**, select the permitted-users policy. The beta package permits all users to self-authorize. Restrict access to the required profile or permission set when the org uses a tighter access policy.

Install the beta package in a sandbox or test org before installing it in a
production Salesforce org.

In Veryfront, open the project and start the Salesforce connection from the
integration prompt or project integration settings. Sign in to the Salesforce
org where the package is installed, approve consent, then run a read-only
Salesforce tool to verify access.

Never paste a Salesforce consumer secret into an agent prompt, project file,
ticket, or client-side environment variable.

## Use a service account

Use a service account when a run needs non-interactive access. Veryfront uses
Salesforce OAuth client credentials and executes as the OAuth app's dedicated
**Run As** integration user. It does not open browser consent or use a user's
personal OAuth token.

In the target Salesforce org:

1. Create a dedicated integration user with the minimum object, field, and API permissions required by the project.
2. Create an External Client App for the client-credentials flow. Existing Connected Apps remain supported.
3. Enable **Client Credentials Flow** and select the **Manage user data via APIs** (`api`) OAuth scope.
4. On the app's **Policies** tab, enable **Client Credentials Flow** and select the dedicated integration user as the **Run As** user.
5. Record the app's consumer key and consumer secret in your approved secret manager.

Set all three values as project environment variables in the matching
Veryfront environment:

| Variable                                   | Value                       |
| ------------------------------------------ | --------------------------- |
| `SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID`     | OAuth app consumer key      |
| `SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET` | OAuth app consumer secret   |
| `SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL`     | Salesforce My Domain origin |

Set `SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL` to the target org's Salesforce My
Domain origin, for example `https://acme.my.salesforce.com`. Veryfront rejects
generic login endpoints such as `https://login.salesforce.com` and
`https://test.salesforce.com`; it also rejects paths and non-HTTPS URLs. Use
the My Domain origin, not the instance URL returned after authentication.

All three variables are required. If any service-account variable is missing,
Veryfront fails closed and does not fall back to a human OAuth connection for
non-interactive runs. Rotate the consumer secret in Salesforce and update the
project environment variable through the approved secret-management workflow.

### Run Salesforce locally

Create an exact-grant local source, load its tools, and pass them to an agent:

```ts
import { agent } from "veryfront/agent";
import { createLocalIntegrationToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const source = createLocalIntegrationToolSource({
  tools: ["salesforce__find_customer"],
});
const integrationTools = await loadRemoteToolsFromSource(source);

export default agent({
  system: "Use Salesforce when the user asks about a customer.",
  tools: integrationTools,
});
```

This path needs no Veryfront account, project token, or hosted integration API.
The host must set `VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS=1` before
it lists or executes a local integration tool.
It reads the three service-account variables from the active project environment,
exchanges them at the configured Salesforce My Domain, and sends the resulting
bearer token only to that org's returned My Domain instance. Raw credentials and
tokens never enter the tool definition, model prompt, arguments, logs, or URLs.

Local Salesforce execution supports the catalog's fixed REST tools and the
client-credentials service account only. Keep using managed execution for a
Salesforce user's authorization-code OAuth connection.

For a local or self-hosted project, create a source with
`createSalesforceServiceAccountToolSource` from `veryfront/integrations`, then
materialize it with `loadRemoteToolsFromSource` from `veryfront/tool` and pass
the result through each agent's `tools` field. The source reads the same three
variables from the host environment and calls Salesforce directly. See
[Self-host Veryfront Code](../self-hosting.md#run-salesforce-integration-tools-locally)
for a complete agent example.

## Verify it worked

1. Start a new agent run that uses a read-only Salesforce tool, such as account or case lookup.
2. Confirm the tool returns data from the target Salesforce org.
3. For a service account, confirm the Salesforce audit trail attributes the request to the configured integration user.

## Related

- [veryfront/integrations](../../api-reference/veryfront/integrations.md): Connector catalog and helper API.
- [Salesforce integration](../../concepts/salesforce-integration.md): Why Veryfront uses a governed Salesforce integration layer.
