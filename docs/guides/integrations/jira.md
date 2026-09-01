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

- You are an Atlassian organization administrator using [centralized user management](https://support.atlassian.com/user-management/docs/understand-service-accounts/). Atlassian Cloud organizations receive up to five free service accounts; Atlassian Guard Standard supports up to 250 and Enterprise supports up to 1,000. Service accounts are not available in Atlassian Government Cloud.
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

The permissions in the table are cumulative with the project's permission scheme and issue
security settings. `Browse Projects` is required in addition to every issue-operation permission
listed in the table; an issue can still be hidden by its issue-security level.

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
   - `write:jira-work` only when the agent creates, edits, comments on, assigns, or transitions issues
   - `read:jira-user` only when the agent uses `jira__search_users`
4. Create the credential and copy the client ID and client secret into your approved secret
   manager. Atlassian does not show the secret again.

This is a service-account credential, not an OAuth 2.0 app credential from the Atlassian
Developer Console. It uses the non-interactive `client_credentials` grant. The access token is
short-lived and Veryfront mints and caches it as needed. See Atlassian's [OAuth 2.0 service-account
credential documentation](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/).

The OAuth access token expires after 60 minutes; Veryfront mints a replacement automatically. The
OAuth client credential remains usable until it is revoked. If it is revoked or replaced, create a
new OAuth 2.0 credential, update both service-account credential variables, and redeploy the
environment before the next run. Do not select **API token** instead: API-token credentials have a
separate 1-365-day expiry and are not used by these client ID and client secret variables.

## 4. Find the Jira Cloud ID

The Cloud ID identifies the Jira site. It is not the Jira hostname, project key, project ID, or
Veryfront project ID.

Open `https://<your-site>.atlassian.net/_edge/tenant_info` and copy the `cloudId` value from the
JSON response. This endpoint identifies that specific Jira site without an OAuth consent flow. You
can also open Atlassian Administration → **Apps → Sites**, select the site, and copy the value
after `/s/` in the URL: `https://admin.atlassian.com/s/<cloud-id>/...`. Atlassian documents both
the [Cloud ID lookup methods](https://support.atlassian.com/jira/kb/retrieve-my-atlassian-sites-cloud-id/)
in Atlassian Administration.

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

1. Start a new agent run that calls `jira__list_projects` or another read tool against a known
   project. Do not use `jira__list_sites` alone as proof of connectivity: in service-identity mode
   that result is synthesized from the configured Cloud ID.
2. Confirm the returned projects or issues belong to the target site and project.
3. If write access is configured, test one write tool against the configured project.
4. If a write was tested, open the affected issue's **Activity/History** and confirm the action is
   attributed to the service account. For comments, confirm the displayed author.

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

If the user can access more than one Atlassian site, also set `JIRA_CLOUD_ID` to the target site's
Cloud ID. Obtain it from the `jira__list_sites` result.

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
