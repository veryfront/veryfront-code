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
- The hosted Veryfront API, which supplies the Salesforce provider adapter. The
  generic Veryfront runtime cannot scaffold or execute Salesforce OAuth routes.
  An embedding host that supplies its own Salesforce adapter must declare
  `VERYFRONT_HOST_ADAPTER_INTEGRATIONS=salesforce` to expose the connector
  catalog. This does not enable generic Salesforce scaffolding.

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
Salesforce OAuth client credentials and executes as the Connected App's
dedicated **Run As** integration user. It does not open browser consent or use
a user's personal OAuth token.

In the target Salesforce org:

1. Create a dedicated integration user with the minimum object, field, and API permissions required by the project.
2. Create or configure a Salesforce Connected App for the client-credentials flow.
3. Enable **Client Credentials Flow** and select the **Manage user data via APIs** (`api`) OAuth scope.
4. In the Connected App policy, set permitted users to **Admin approved users are pre-authorized**, then select the dedicated integration user as the **Run As** user.
5. Record the Connected App consumer key and consumer secret in your approved secret manager.

Set all three values as project environment variables in the matching
Veryfront environment:

| Variable                                   | Value                         |
| ------------------------------------------ | ----------------------------- |
| `SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID`     | Connected App consumer key    |
| `SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET` | Connected App consumer secret |
| `SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL`     | Salesforce My Domain origin   |

Set `SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL` to the target org's Salesforce My
Domain origin, for example `https://acme.my.salesforce.com`. Veryfront rejects
generic login endpoints such as `https://login.salesforce.com` and
`https://test.salesforce.com`; it also rejects paths and non-HTTPS URLs. Use
the My Domain origin, not the instance URL returned after authentication.

All three variables are required. If any service-account variable is missing,
Veryfront fails closed and does not fall back to a human OAuth connection for
non-interactive runs. Rotate the consumer secret in Salesforce and update the
project environment variable through the approved secret-management workflow.

## Verify it worked

1. Start a new agent run that uses a read-only Salesforce tool, such as account or case lookup.
2. Confirm the tool returns data from the target Salesforce org.
3. For a service account, confirm the Salesforce audit trail attributes the request to the configured integration user.

## Next

- [Integrations](../integrations.md): Declare Salesforce tools and apply source or project policy.
- [Set up GitHub](./github.md): Connect a GitHub provider.
- [Set up Jira](./jira.md): Connect a Jira provider.

## Related

- [veryfront/integrations](../../api-reference/veryfront/integrations.md): Connector catalog and helper API.
- [Salesforce integration](../../concepts/salesforce-integration.md): Why Veryfront uses a governed Salesforce integration layer.
