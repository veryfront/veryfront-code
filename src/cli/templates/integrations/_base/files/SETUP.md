# Integration Setup Guide

This guide helps you set up credentials for all 50+ service integrations available in Veryfront.

## Quick Start

```bash
# Create a new project with integrations
veryfront init my-app --with ai --integrations slack,github,notion

# Start development
cd my-app
veryfront dev
```

Visit `http://localhost:3000/api/auth/{service}` to connect each service.

---

## Table of Contents

- [Google Services](#google-services) (Gmail, Calendar, Drive, Docs, Sheets)
- [Microsoft Services](#microsoft-services) (Outlook, Teams, SharePoint, OneDrive)
- [Atlassian Services](#atlassian-services) (Jira, Confluence)
- [Communication](#communication) (Slack, Discord, Twilio, Zoom, Webex)
- [Project Management](#project-management) (Asana, Monday, Trello, ClickUp, Linear, Notion)
- [Developer Tools](#developer-tools) (GitHub, GitLab, Bitbucket, Figma, Sentry, PostHog)
- [CRM & Sales](#crm--sales) (Salesforce, HubSpot, Pipedrive, Intercom, Zendesk, Freshdesk)
- [Databases](#databases) (Supabase, Neon, Airtable, Snowflake)
- [Cloud & Storage](#cloud--storage) (AWS, Dropbox, Box)
- [Finance](#finance) (Stripe, QuickBooks, Xero)
- [Marketing](#marketing) (Mailchimp, Twitter)
- [E-commerce](#e-commerce) (Shopify)
- [AI & Analytics](#ai--analytics) (Anthropic, Mixpanel)

---

## Google Services

**Gmail, Calendar, Drive, Docs, Sheets** all use the same Google OAuth credentials.

### Setup Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Enable required APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
4. Go to **OAuth consent screen**:
   - User Type: External (or Internal for Workspace)
   - Add scopes for each API you need
5. Go to **Credentials** > **Create Credentials** > **OAuth client ID**:
   - Application type: Web application
   - Authorized redirect URIs:
     ```
     http://localhost:3000/api/auth/gmail/callback
     http://localhost:3000/api/auth/calendar/callback
     http://localhost:3000/api/auth/drive/callback
     http://localhost:3000/api/auth/docs-google/callback
     http://localhost:3000/api/auth/sheets/callback
     ```

### Environment Variables

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Required Scopes by Service

| Service | Scopes |
|---------|--------|
| Gmail | `gmail.readonly`, `gmail.send`, `gmail.modify` |
| Calendar | `calendar.readonly`, `calendar.events` |
| Drive | `drive.readonly`, `drive.file` |
| Docs | `documents.readonly`, `documents` |
| Sheets | `spreadsheets.readonly`, `spreadsheets` |

---

## Microsoft Services

**Outlook, Teams, SharePoint, OneDrive** use Microsoft OAuth (Azure AD).

### Setup Steps

1. Go to [Azure Portal](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**:
   - Name: Your app name
   - Supported account types: Accounts in any organizational directory
   - Redirect URI: Web, `http://localhost:3000/api/auth/outlook/callback`
3. After creation, go to **Certificates & secrets**:
   - Create a new client secret
4. Go to **API permissions**:
   - Add Microsoft Graph permissions

### Environment Variables

```env
MICROSOFT_CLIENT_ID=your-application-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=common
```

### Required Scopes by Service

| Service | Scopes |
|---------|--------|
| Outlook | `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite` |
| Teams | `Team.ReadBasic.All`, `Chat.ReadWrite`, `ChannelMessage.Send` |
| SharePoint | `Sites.Read.All`, `Files.ReadWrite.All` |
| OneDrive | `Files.Read`, `Files.ReadWrite` |

---

## Atlassian Services

**Jira and Confluence** use Atlassian OAuth 2.0 (3LO).

### Setup Steps

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Click **Create** > **OAuth 2.0 integration**
3. Configure:
   - Name: Your app name
   - Callback URL: `http://localhost:3000/api/auth/jira/callback`
4. Add required scopes in **Permissions**
5. Get your Cloud ID: Visit `https://your-domain.atlassian.net/_edge/tenant_info`

### Environment Variables

```env
ATLASSIAN_CLIENT_ID=your-client-id
ATLASSIAN_CLIENT_SECRET=your-client-secret
ATLASSIAN_CLOUD_ID=your-cloud-id
```

### Required Scopes

| Service | Scopes |
|---------|--------|
| Jira | `read:jira-work`, `write:jira-work`, `read:jira-user` |
| Confluence | `read:confluence-content.all`, `write:confluence-content` |

---

## Communication

### Slack

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Go to **OAuth & Permissions**:
   - Add redirect URL: `http://localhost:3000/api/auth/slack/callback`
   - Add scopes: `channels:read`, `chat:write`, `users:read`, `im:write`
4. **Install to Workspace**

```env
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
```

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create **New Application**
3. Go to **OAuth2**:
   - Add redirect: `http://localhost:3000/api/auth/discord/callback`
   - Scopes: `identify`, `guilds`, `messages.read`

```env
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
```

### Twilio (SMS/WhatsApp)

1. Go to [Twilio Console](https://console.twilio.com/)
2. Get Account SID and Auth Token from dashboard
3. Get or buy a phone number for sending

```env
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### Zoom

1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/develop/create)
2. Create **OAuth App**
3. Configure redirect: `http://localhost:3000/api/auth/zoom/callback`
4. Add scopes: `meeting:read`, `meeting:write`, `user:read`

```env
ZOOM_CLIENT_ID=your-client-id
ZOOM_CLIENT_SECRET=your-client-secret
```

### Webex

1. Go to [Webex for Developers](https://developer.webex.com/my-apps)
2. Create new integration
3. Redirect URI: `http://localhost:3000/api/auth/webex/callback`
4. Scopes: `spark:messages_read`, `spark:messages_write`, `spark:rooms_read`

```env
WEBEX_CLIENT_ID=your-client-id
WEBEX_CLIENT_SECRET=your-client-secret
```

---

## Project Management

### Asana

1. Go to [Asana Developer Console](https://app.asana.com/0/developer-console)
2. Create new app
3. Set redirect URL: `http://localhost:3000/api/auth/asana/callback`

```env
ASANA_CLIENT_ID=your-client-id
ASANA_CLIENT_SECRET=your-client-secret
```

### Monday.com

1. Go to [Monday Apps](https://auth.monday.com/oauth2/authorize)
2. Create new app in your account's Developer section
3. Configure OAuth with redirect: `http://localhost:3000/api/auth/monday/callback`

```env
MONDAY_CLIENT_ID=your-client-id
MONDAY_CLIENT_SECRET=your-client-secret
```

### Trello

1. Go to [Trello Power-Ups Admin](https://trello.com/power-ups/admin)
2. Create new Power-Up
3. Configure OAuth redirect: `http://localhost:3000/api/auth/trello/callback`

```env
TRELLO_API_KEY=your-api-key
TRELLO_API_SECRET=your-api-secret
```

### ClickUp

1. Go to [ClickUp API Settings](https://app.clickup.com/settings/apps)
2. Create new app
3. Redirect URL: `http://localhost:3000/api/auth/clickup/callback`

```env
CLICKUP_CLIENT_ID=your-client-id
CLICKUP_CLIENT_SECRET=your-client-secret
```

### Linear

1. Go to [Linear Settings > API](https://linear.app/settings/api)
2. Create OAuth application
3. Callback URL: `http://localhost:3000/api/auth/linear/callback`

```env
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
```

### Notion

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Create new **public** integration (for OAuth)
3. Set redirect URI: `http://localhost:3000/api/auth/notion/callback`
4. **Important**: Share pages with your integration

```env
NOTION_CLIENT_ID=your-oauth-client-id
NOTION_CLIENT_SECRET=your-oauth-client-secret
```

---

## Developer Tools

### GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create **New OAuth App**
3. Authorization callback: `http://localhost:3000/api/auth/github/callback`

```env
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

### GitLab

1. Go to [GitLab Applications](https://gitlab.com/-/profile/applications)
2. Create new application
3. Redirect URI: `http://localhost:3000/api/auth/gitlab/callback`
4. Scopes: `read_user`, `read_api`, `read_repository`

```env
GITLAB_CLIENT_ID=your-application-id
GITLAB_CLIENT_SECRET=your-secret
```

### Bitbucket

1. Go to [Bitbucket App Passwords](https://bitbucket.org/account/settings/app-passwords/) or create OAuth consumer
2. For OAuth: Workspace settings > OAuth consumers
3. Callback URL: `http://localhost:3000/api/auth/bitbucket/callback`

```env
BITBUCKET_CLIENT_ID=your-client-id
BITBUCKET_CLIENT_SECRET=your-client-secret
```

### Figma

1. Go to [Figma Developers](https://www.figma.com/developers/apps)
2. Create new app
3. Callback URL: `http://localhost:3000/api/auth/figma/callback`

```env
FIGMA_CLIENT_ID=your-client-id
FIGMA_CLIENT_SECRET=your-client-secret
```

### Sentry

1. Go to [Sentry Developer Settings](https://sentry.io/settings/developer-settings/)
2. Create new public integration
3. Redirect URL: `http://localhost:3000/api/auth/sentry/callback`

```env
SENTRY_CLIENT_ID=your-client-id
SENTRY_CLIENT_SECRET=your-client-secret
```

### PostHog

Uses API key authentication (no OAuth).

1. Go to your PostHog project settings
2. Create a personal API key

```env
POSTHOG_API_KEY=phx_your-api-key
POSTHOG_HOST=https://app.posthog.com
```

---

## CRM & Sales

### Salesforce

1. Go to [Salesforce Setup](https://login.salesforce.com/) > App Manager
2. Create **New Connected App**
3. Enable OAuth, add callback: `http://localhost:3000/api/auth/salesforce/callback`
4. Required scopes: `api`, `refresh_token`

```env
SALESFORCE_CLIENT_ID=your-consumer-key
SALESFORCE_CLIENT_SECRET=your-consumer-secret
```

### HubSpot

1. Go to [HubSpot Developers](https://developers.hubspot.com/)
2. Create app in your developer account
3. Configure OAuth redirect: `http://localhost:3000/api/auth/hubspot/callback`
4. Select required scopes

```env
HUBSPOT_CLIENT_ID=your-client-id
HUBSPOT_CLIENT_SECRET=your-client-secret
```

### Pipedrive

1. Go to [Pipedrive Marketplace Manager](https://developers.pipedrive.com/)
2. Create new app
3. OAuth redirect: `http://localhost:3000/api/auth/pipedrive/callback`

```env
PIPEDRIVE_CLIENT_ID=your-client-id
PIPEDRIVE_CLIENT_SECRET=your-client-secret
```

### Intercom

1. Go to [Intercom Developer Hub](https://developers.intercom.com/)
2. Create new app
3. Configure OAuth: `http://localhost:3000/api/auth/intercom/callback`

```env
INTERCOM_CLIENT_ID=your-client-id
INTERCOM_CLIENT_SECRET=your-client-secret
```

### Zendesk

1. Go to Admin Center > Apps and integrations > APIs > Zendesk API
2. Create OAuth client
3. Redirect URL: `http://localhost:3000/api/auth/zendesk/callback`

```env
ZENDESK_CLIENT_ID=your-client-id
ZENDESK_CLIENT_SECRET=your-client-secret
ZENDESK_SUBDOMAIN=your-subdomain
```

### Freshdesk

Uses API key authentication.

1. Go to Profile Settings in Freshdesk
2. Find your API Key

```env
FRESHDESK_API_KEY=your-api-key
FRESHDESK_DOMAIN=your-domain.freshdesk.com
```

---

## Databases

### Supabase

Uses API key (no OAuth needed).

1. Go to your Supabase project dashboard
2. Go to Settings > API
3. Copy the `anon` or `service_role` key

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Neon

Uses API key authentication.

1. Go to [Neon Console](https://console.neon.tech/)
2. Create API key in Account Settings

```env
NEON_API_KEY=your-api-key
NEON_PROJECT_ID=your-project-id
```

### Airtable

1. Go to [Airtable Account](https://airtable.com/account)
2. Create personal access token or OAuth app
3. For OAuth: [Airtable OAuth](https://airtable.com/create/oauth)

```env
AIRTABLE_API_KEY=your-api-key
# Or for OAuth:
AIRTABLE_CLIENT_ID=your-client-id
AIRTABLE_CLIENT_SECRET=your-client-secret
```

### Snowflake

Uses account credentials (key-pair or password).

1. Get your Snowflake account identifier
2. Create a user with appropriate permissions
3. (Optional) Set up key-pair authentication

```env
SNOWFLAKE_ACCOUNT=your-account-identifier
SNOWFLAKE_USERNAME=your-username
SNOWFLAKE_PASSWORD=your-password
SNOWFLAKE_WAREHOUSE=your-warehouse
SNOWFLAKE_DATABASE=your-database
```

---

## Cloud & Storage

### AWS

Uses IAM credentials.

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Create a new IAM user with programmatic access
3. Attach policies for services you need (S3, EC2, Lambda, etc.)

```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

### Dropbox

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Create app with Full Dropbox or App folder access
3. OAuth2 redirect: `http://localhost:3000/api/auth/dropbox/callback`

```env
DROPBOX_CLIENT_ID=your-app-key
DROPBOX_CLIENT_SECRET=your-app-secret
```

### Box

1. Go to [Box Developer Console](https://app.box.com/developers/console)
2. Create new app with OAuth 2.0
3. Redirect URI: `http://localhost:3000/api/auth/box/callback`

```env
BOX_CLIENT_ID=your-client-id
BOX_CLIENT_SECRET=your-client-secret
```

---

## Finance

### Stripe

Uses API key (no OAuth for basic usage).

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Get your secret key (use test key for development)

```env
STRIPE_SECRET_KEY=sk_test_your-secret-key
STRIPE_PUBLISHABLE_KEY=pk_test_your-publishable-key
```

### QuickBooks

1. Go to [Intuit Developer](https://developer.intuit.com/)
2. Create app and get OAuth credentials
3. Redirect URI: `http://localhost:3000/api/auth/quickbooks/callback`

```env
QUICKBOOKS_CLIENT_ID=your-client-id
QUICKBOOKS_CLIENT_SECRET=your-client-secret
```

### Xero

1. Go to [Xero Developer](https://developer.xero.com/app/manage)
2. Create app
3. Redirect URI: `http://localhost:3000/api/auth/xero/callback`

```env
XERO_CLIENT_ID=your-client-id
XERO_CLIENT_SECRET=your-client-secret
```

---

## Marketing

### Mailchimp

1. Go to [Mailchimp Account API Keys](https://us1.admin.mailchimp.com/account/api/)
2. For OAuth: Register app at [Mailchimp OAuth](https://admin.mailchimp.com/account/oauth2/)
3. Redirect: `http://localhost:3000/api/auth/mailchimp/callback`

```env
MAILCHIMP_CLIENT_ID=your-client-id
MAILCHIMP_CLIENT_SECRET=your-client-secret
# Or API key:
MAILCHIMP_API_KEY=your-api-key-us1
```

### Twitter/X

1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Create project and app
3. Enable OAuth 2.0
4. Callback URL: `http://localhost:3000/api/auth/twitter/callback`

```env
TWITTER_CLIENT_ID=your-client-id
TWITTER_CLIENT_SECRET=your-client-secret
```

---

## E-commerce

### Shopify

1. Go to [Shopify Partners](https://partners.shopify.com/)
2. Create new app
3. App URL and redirect: `http://localhost:3000/api/auth/shopify/callback`

```env
SHOPIFY_CLIENT_ID=your-api-key
SHOPIFY_CLIENT_SECRET=your-api-secret
SHOPIFY_SHOP_NAME=your-store.myshopify.com
```

---

## AI & Analytics

### Anthropic (Admin API)

For organization management and usage tracking.

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create Admin API key (requires admin access)

```env
ANTHROPIC_ADMIN_API_KEY=your-admin-api-key
```

### Mixpanel

Uses API key/secret for data export.

1. Go to [Mixpanel Project Settings](https://mixpanel.com/settings/project)
2. Get Project Token for tracking
3. Get API Secret for data export

```env
MIXPANEL_PROJECT_TOKEN=your-project-token
MIXPANEL_API_SECRET=your-api-secret
```

---

## Testing Your Setup

After configuring credentials:

```bash
# Start the dev server
veryfront dev

# Test each integration by visiting:
# http://localhost:3000/api/auth/{service}

# Check connection status
curl http://localhost:3000/api/connections
```

## Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| "Invalid redirect URI" | Ensure callback URL matches exactly (including trailing slash) |
| "Invalid client" | Check CLIENT_ID is correct and app is published |
| "Access denied" | Verify all required scopes are added |
| "Token expired" | Implement refresh token flow or re-authenticate |

### Debug Mode

Enable debug logging:

```bash
DEBUG=veryfront:oauth veryfront dev
```

### Token Storage

By default, tokens are stored in memory. For production:

1. Implement `TokenStore` interface in `lib/token-store.ts`
2. Use Redis, database, or encrypted file storage
3. Handle token refresh automatically

## Production Checklist

- [ ] Update all redirect URIs to production domain
- [ ] Implement persistent token storage
- [ ] Set up token encryption
- [ ] Configure rate limiting
- [ ] Add error monitoring (Sentry)
- [ ] Test OAuth flows end-to-end
- [ ] Review and minimize required scopes

## Need Help?

- Run `veryfront doctor` to diagnose issues
- Check the [Veryfront Documentation](https://veryfront.com/docs)
- Join our [Discord community](https://discord.gg/veryfront)
