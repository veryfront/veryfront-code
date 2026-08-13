---
title: "Set up Jira"
description: "Connect an Atlassian account to Veryfront for Jira project and issue tools."
order: 52
---

Use Jira OAuth when an agent needs to read or update Jira projects and issues.

## Connect a Jira user

1. In Veryfront, open the project that needs Jira tools.
2. Start the Jira connection from the integration prompt or project integration settings.
3. Sign in to Atlassian and approve the requested access.
4. Run a read-only Jira tool, such as listing accessible sites or projects, to verify the connection.

Managed Atlassian OAuth works without project credentials. Set project
credentials only when the project must use its own Atlassian OAuth app.

## Use your own Atlassian OAuth app

1. In the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), create an OAuth 2.0 app.
2. Add the exact callback URL for the target environment:
   - Production: `https://api.veryfront.com/oauth/callback/jira`
   - Staging: `https://api.veryfront.org/oauth/callback/jira`
3. These are the hosted Veryfront provider-adapter callbacks. A self-hosted
   framework application instead registers its own `APP_URL` origin with
   `/api/auth/jira/callback`.
4. Grant all four scopes that the Jira connector requests by default:
   - `read:jira-work` for Jira reads.
   - `write:jira-work` for write tools.
   - `read:jira-user` for `jira__search_users`.
   - `offline_access` to receive refresh tokens. Veryfront uses refresh tokens
     to keep a user connection active; omit it only when the connection must
     not be refreshable.
5. Set the OAuth app client ID and client secret as project environment variables:

| Variable                  | Value                         |
| ------------------------- | ----------------------------- |
| `ATLASSIAN_CLIENT_ID`     | Atlassian OAuth client ID     |
| `ATLASSIAN_CLIENT_SECRET` | Atlassian OAuth client secret |

Set `JIRA_CLOUD_ID` when the connected user has access to more than one
Atlassian site. Obtain the site ID from the list-sites tool result.

Keep the secret in your approved secret manager. Never place it in agent
prompts, project files, tickets, or client-side environment variables.

## Verify it worked

1. Start a new agent run that uses a read-only Jira tool.
2. Confirm the tool returns the expected Atlassian site or Jira project data.

## Next

- [Integrations](../integrations.md): Declare Jira tools and apply source or project policy.
- [Set up GitHub](./github.md): Connect a GitHub provider.
- [Set up Salesforce](./salesforce.md): Connect a Salesforce provider.

## Related

- [veryfront/integrations](../../api-reference/veryfront/integrations.md): Connector catalog and helper API.
