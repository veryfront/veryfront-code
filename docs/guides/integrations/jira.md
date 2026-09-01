---
title: "Set up Jira service-account access"
description: "Run hosted Veryfront Jira tools as a dedicated Atlassian service account without browser consent."
order: 52
---

This guide is for hosted Veryfront projects using the platform Jira service-identity path. Use a
dedicated Atlassian service account when a project-owned or scheduled agent must read and update
Jira without acting as a person's Atlassian user.

This setup uses Atlassian OAuth 2.0 client credentials (2LO). It does not open a browser or use
the interactive user OAuth flow. The service-account variables below are consumed by the hosted
Veryfront API; they are not settings for the generic local `veryfront-code` connector.

## Before you start

- You are an Atlassian organization administrator using [centralized user management](https://support.atlassian.com/user-management/docs/understand-service-accounts/).
- You have a Jira Cloud site and a company-managed target Jira project key. This walkthrough does
  not cover team-managed projects, which use a different project-access and role model.
- Your Veryfront project has Jira enabled and includes the Jira tools the agent may call.

## 1. Create a Jira service account

1. Open [Atlassian Administration](https://admin.atlassian.com/) and select the organization that
   owns the Jira site.
2. Select **Directory → Service accounts → Create a service account**.
3. Give the account a purpose-specific name, such as `Veryfront travel automation`.
4. Grant it access to the Jira product. Do not grant unrelated products.

Atlassian’s [service-account guide](https://support.atlassian.com/user-management/docs/understand-service-accounts/)
contains the current account-management steps.

## 2. Add it to the Jira project

1. Open the target Jira project and select **Project settings → People**.
2. Select **Add people**, choose the service account, and assign a project role.
3. Use the least-privilege role that grants the actions your agent needs:

| Agent operation | Jira permission |
| --- | --- |
| Read or search projects and issues | Browse Projects and issue read access |
| Create issues | Create Issues |
| Edit issues | Edit Issues |
| Add comments | Add Comments |
| Change status | Transition Issues |
| Assign issues | Assign Issues |
| Search Jira users | Browse users and groups |

Use Jira's [project-permission documentation](https://support.atlassian.com/jira-cloud-administration/docs/permissions-for-company-managed-projects/)
and permission helper to verify the service account. For Jira Service Management workflows, also
grant the appropriate service-desk agent permissions.

`Browse users and groups` is a Jira global permission, not a project role. Grant it in Jira
administration when the agent uses `jira__search_users`; the `read:jira-user` OAuth scope is also
required for that tool. If a tool sets `assignee`, the target user must also be assignable in the
project.

## 3. Create the service-account credential

1. In [Atlassian Administration](https://admin.atlassian.com/), open **Directory → Service
   accounts** and select the service account.
2. Select **Create credentials → OAuth 2.0**.
3. Select the Jira scopes required by the agent. Start with:
   - `read:jira-work`
   - `write:jira-work` only when the agent creates, edits, comments on, or transitions issues
   - `read:jira-user` only when the agent uses `jira__search_users`
4. Create the credential and copy the client ID and client secret into your approved secret
   manager. Atlassian does not show the secret again.

This is a service-account credential, not an OAuth 2.0 app credential from the Atlassian
Developer Console. It uses the non-interactive `client_credentials` grant. The access token is
short-lived and Veryfront mints and caches it as needed. See Atlassian’s [OAuth 2.0 service-account
credential documentation](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/).

## 4. Find the Jira Cloud ID

The Cloud ID identifies the Jira site. It is not the Jira hostname, project key, project ID, or
Veryfront project ID.

Use the service-account access token with Atlassian’s `accessible-resources` endpoint and copy
the `id` for the target Jira site. See [Making calls to the Jira API](https://developer.atlassian.com/cloud/oauth/getting-started/making-calls-to-api/)
for the gateway URL and Cloud ID format.

## 5. Configure the Veryfront project

Open the Veryfront environment used by the agent run and add these variables:

| Variable | Value |
| --- | --- |
| `ATLASSIAN_SERVICE_ACCOUNT_CLIENT_ID` | The service-account OAuth 2.0 client ID |
| `ATLASSIAN_SERVICE_ACCOUNT_CLIENT_SECRET` | The service-account OAuth 2.0 client secret |
| `ATLASSIAN_SERVICE_ACCOUNT_CLOUD_ID` | The target Jira site Cloud ID |
| `JIRA_SERVICE_PROJECT_KEY` | The target Jira project key, required for write tools |

Then enable Jira for the Veryfront project and allow the specific `jira__*` tools the agent may
use. Set the variables in the same environment where the agent runs.

Do not set `ATLASSIAN_CLIENT_ID` or `ATLASSIAN_CLIENT_SECRET` for this setup. Those variables
select the interactive user-consent OAuth flow. Do not put the service-account secret in source
files, prompts, tickets, browser code, URLs, or logs.

`JIRA_SERVICE_PROJECT_KEY` is optional for read-only tools and required for write tools. For
writes, Veryfront rejects the call unless the target issue or project belongs to the configured
project key before sending the request to Jira.

## Verify it worked

1. Start a new agent run that calls `jira__list_sites` or `jira__list_projects`.
2. Confirm the result is from the configured Cloud ID.
3. If write access is configured, test one write tool against the configured project.
4. If a write was tested, confirm Jira's audit history attributes the action to the service account.

No browser or Atlassian consent page should open. If it does, check the variable names, selected
Veryfront environment, Jira project integration, and tool policy. A Cloud ID by itself does not
activate service-account mode.

## If you need user OAuth instead

For hosted projects, managed Atlassian OAuth does not require project client credentials. Start the
Jira connection from the project's integration settings and complete the Atlassian consent flow.

For a self-hosted framework deployment using a custom Atlassian OAuth app, register the deployment
callback as `https://<your-deployment-host>/api/auth/jira/callback`, then grant the scopes used by
the Jira connector:

- `read:jira-work` for Jira reads.
- `write:jira-work` for write tools.
- `read:jira-user` for `jira__search_users`.
- `offline_access` so the user connection can refresh after the access token expires.

Set these project variables:

| Variable | Value |
| --- | --- |
| `ATLASSIAN_CLIENT_ID` | Atlassian OAuth app client ID |
| `ATLASSIAN_CLIENT_SECRET` | Atlassian OAuth app client secret |

That is the interactive authorization-code (3LO) path used by the generic `veryfront-code` Jira
connector. See [managed OAuth and custom app overrides](../integrations.md#managed-oauth-and-custom-app-overrides)
for the distinction between hosted and self-hosted setups.

## Service account versus user OAuth

| | Service account | User OAuth |
| --- | --- | --- |
| Browser consent | Not used | Required |
| Identity | Dedicated Atlassian account | Individual Atlassian user |
| Variables | `ATLASSIAN_SERVICE_ACCOUNT_*` | Managed OAuth: none; custom app: `ATLASSIAN_CLIENT_*` |
| Token grant | `client_credentials` (2LO) | `authorization_code` (3LO) |
| Best for | Scheduled or project-owned automation | Actions that must act as the person |

This guide covers Jira service-account access. Confluence service identity is not currently
covered by the Veryfront service-identity path.

## Related

- [Jira integration reference](../../api-reference/veryfront/integrations.md)
- [Atlassian service-account OAuth 2.0 documentation](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/)
