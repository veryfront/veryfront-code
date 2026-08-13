---
title: "Set up GitHub"
description: "Connect a GitHub account to Veryfront for repository, issue, and pull-request tools."
order: 51
---

Use GitHub OAuth when an agent needs repository, issue, or pull-request tools.

## Connect a GitHub user

1. In Veryfront, open the project that needs GitHub tools.
2. Start the GitHub connection from the integration prompt or project integration settings.
3. Sign in to GitHub and approve the requested access.
4. Run a read-only GitHub tool, such as listing repositories, to verify the connection.

Managed GitHub OAuth works without project credentials. Set project credentials
only when the project must use its own GitHub OAuth app for custom consent
branding, verification, or scope requirements.

## Use your own GitHub OAuth app

1. In [GitHub Developer Settings](https://github.com/settings/developers), create an OAuth App.
2. Add the Veryfront callback URL for the target environment.
3. Set the OAuth app client ID and client secret as project environment variables:

| Variable               | Value                          |
| ---------------------- | ------------------------------ |
| `GITHUB_CLIENT_ID`     | GitHub OAuth App client ID     |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |

Keep the secret in your approved secret manager. Never place it in agent
prompts, project files, tickets, or client-side environment variables.

## Verify it worked

1. Start a new agent run that uses a read-only GitHub tool.
2. Confirm the tool returns the connected user's GitHub data.

## Next

- [Integrations](../integrations.md): Declare GitHub tools and apply source or project policy.
- [Set up Jira](./jira.md): Connect a Jira provider.
- [Set up Salesforce](./salesforce.md): Connect a Salesforce provider.

## Related

- [veryfront/integrations](../../api-reference/veryfront/integrations.md): Connector catalog and helper API.
