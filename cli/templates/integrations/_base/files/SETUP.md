# Integration Setup Guide

This guide covers the supported built-in Veryfront integrations.

## Supported integrations

- Google: Gmail, Calendar, Drive, Google Docs, Google Sheets
- Microsoft: Outlook, Teams, SharePoint, OneDrive
- Atlassian: Jira, Confluence
- Communication: Slack
- Productivity: Asana, Linear, Notion
- Development: GitHub, GitLab
- Design: Figma
- Data: Airtable

Visit `http://localhost:3000/api/auth/{service}` to connect each OAuth service.

## Google Services

**Gmail, Calendar, Drive, Google Docs, and Google Sheets** use the same Google OAuth credentials.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable the APIs you need: Gmail, Calendar, Drive, Docs, Sheets
4. Create OAuth 2.0 Web application credentials
5. Add redirect URIs for every enabled service:
   - `http://localhost:3000/api/auth/gmail/callback`
   - `http://localhost:3000/api/auth/calendar/callback`
   - `http://localhost:3000/api/auth/drive/callback`
   - `http://localhost:3000/api/auth/docs-google/callback`
   - `http://localhost:3000/api/auth/sheets/callback`

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

## Microsoft Services

**Outlook, Teams, SharePoint, and OneDrive** use Microsoft OAuth through Microsoft Graph.

1. Go to [Azure Portal app registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Create a new app registration
3. Add the relevant callback URLs, such as `http://localhost:3000/api/auth/outlook/callback`
4. Create a client secret
5. Add the Microsoft Graph permissions your selected services need

```env
MICROSOFT_CLIENT_ID=your-application-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=common
```

## Atlassian Services

**Jira and Confluence** use Atlassian OAuth 2.0 (3LO).

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Create an OAuth 2.0 integration
3. Add callback URLs, such as `http://localhost:3000/api/auth/jira/callback`
4. Add Jira/Confluence scopes in Permissions
5. Get your Cloud ID from `https://your-domain.atlassian.net/_edge/tenant_info`

```env
ATLASSIAN_CLIENT_ID=your-client-id
ATLASSIAN_CLIENT_SECRET=your-client-secret
ATLASSIAN_CLOUD_ID=your-cloud-id
```

## Slack

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app
3. Add redirect URL: `http://localhost:3000/api/auth/slack/callback`
4. Add scopes: `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`
5. Install to your workspace

```env
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
```

## GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create an OAuth app
3. Add callback URL: `http://localhost:3000/api/auth/github/callback`

```env
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

## GitLab

1. Go to GitLab **Preferences > Applications**
2. Create an OAuth application
3. Add callback URL: `http://localhost:3000/api/auth/gitlab/callback`

```env
GITLAB_CLIENT_ID=your-client-id
GITLAB_CLIENT_SECRET=your-client-secret
```

## Asana

1. Go to [Asana Developer Console](https://app.asana.com/0/developer-console)
2. Create an app
3. Add callback URL: `http://localhost:3000/api/auth/asana/callback`

```env
ASANA_CLIENT_ID=your-client-id
ASANA_CLIENT_SECRET=your-client-secret
```

## Linear

1. Go to [Linear Settings > API](https://linear.app/settings/api)
2. Create an OAuth application
3. Add callback URL: `http://localhost:3000/api/auth/linear/callback`

```env
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
```

## Notion

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Create a public OAuth integration
3. Add callback URL: `http://localhost:3000/api/auth/notion/callback`

```env
NOTION_CLIENT_ID=your-client-id
NOTION_CLIENT_SECRET=your-client-secret
```

## Figma

1. Go to [Figma Developer Settings](https://www.figma.com/developers/apps)
2. Create an OAuth app
3. Add callback URL: `http://localhost:3000/api/auth/figma/callback`
4. Request the `file_read` scope

```env
FIGMA_CLIENT_ID=your-client-id
FIGMA_CLIENT_SECRET=your-client-secret
```

## Airtable

1. Go to [Airtable Developer Hub](https://airtable.com/developers/web)
2. Create an OAuth integration
3. Add callback URL: `http://localhost:3000/api/auth/airtable/callback`
4. Request record and schema read/write scopes as needed

```env
AIRTABLE_CLIENT_ID=your-client-id
AIRTABLE_CLIENT_SECRET=your-client-secret
```
