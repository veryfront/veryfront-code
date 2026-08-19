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
credentials only for a self-hosted framework deployment that owns one
distributable Atlassian OAuth app. Hosted Veryfront projects must use the
managed OAuth connection.

## Use an Atlassian OAuth app in a self-hosted deployment

1. In the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), create an OAuth 2.0 app.
2. Register your deployment's `APP_URL` origin with
   `/api/auth/jira/callback`, for example
   `https://app.example.com/api/auth/jira/callback`.
3. Grant all four scopes that the Jira connector requests by default:
   - `read:jira-work` for Jira reads.
   - `write:jira-work` for write tools.
   - `read:jira-user` for `jira__search_users`.
   - `offline_access` to receive refresh tokens. Veryfront uses refresh tokens
     to keep a user connection active; omit it only when the connection must
     not be refreshable.
4. Open **Distribution** and enable sharing. An OAuth 2.0 (3LO) app is private
   when created, so only the account that owns it can authorize. Leave sharing
   off and every other user reaches Atlassian, picks their site, and gets
   Atlassian's own "Something went wrong" page. Your deployment never sees the
   callback, so nothing surfaces in your logs. Test with an account outside the
   app owner's Atlassian organization; the owner's account succeeds either way
   and proves nothing.
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

## Related

- [veryfront/integrations](../../api-reference/veryfront/integrations.md): Connector catalog and helper API.
