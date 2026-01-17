# Integrations

Connect your AI agents to 50+ external services with pre-built OAuth authentication, API clients, and AI tools.

## Overview

Integrations enable your AI agents to interact with external services like Gmail, Slack, GitHub, and Salesforce. Each integration includes:

- **OAuth routes** for secure authentication
- **API client** for service communication
- **AI tools** that agents can invoke

## Getting Started

### Add Integrations to a New Project

```bash
veryfront init my-project --integrations gmail,slack,calendar
```

### Use the Interactive Wizard

```bash
veryfront init
```

The wizard guides you through selecting a template and integrations.

## Available Integrations

### Communication

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Gmail | 3 | Read, search, send emails |
| Slack | 5 | Messages, channels, search |
| Outlook | 4 | Email via Microsoft Graph |
| Teams | 4 | Chat, meetings |
| Discord | 3 | Messages, server management |
| Webex | 3 | Messaging, meetings |
| Zoom | 4 | Meetings, webinars |
| Twilio | 3 | SMS, voice |

### Productivity

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Calendar | 4 | Google Calendar events |
| Notion | 5 | Pages, databases, blocks |
| Jira | 6 | Issues, projects, sprints |
| Linear | 5 | Issue tracking |
| Asana | 5 | Tasks, projects |
| Trello | 4 | Boards, lists, cards |
| Monday | 4 | Work management |
| ClickUp | 5 | Tasks, docs |
| Confluence | 4 | Wiki pages, spaces |

### Development

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| GitHub | 6 | Repos, issues, PRs, actions |
| GitLab | 5 | Repos, merge requests, pipelines |
| Bitbucket | 4 | Repos, pull requests |
| Sentry | 3 | Error tracking |
| PostHog | 3 | Product analytics |
| Mixpanel | 3 | Analytics, events |

### Storage

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Google Drive | 4 | Files, folders |
| Google Docs | 3 | Documents |
| Google Sheets | 4 | Spreadsheets |
| OneDrive | 4 | Microsoft files |
| SharePoint | 4 | Enterprise content |
| Dropbox | 4 | File storage |
| Box | 4 | Enterprise files |
| Airtable | 5 | Database, spreadsheet |

### Infrastructure

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Supabase | 5 | Postgres, auth, storage |
| Neon | 4 | Serverless Postgres |
| Snowflake | 3 | Data warehouse |
| AWS | 6 | S3, Lambda, DynamoDB |

### Sales & CRM

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Salesforce | 6 | CRM, sales automation |
| HubSpot | 5 | Marketing, sales |
| Pipedrive | 4 | Sales pipeline |

### Support

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Zendesk | 5 | Tickets, support |
| Intercom | 4 | Customer messaging |
| Freshdesk | 4 | Help desk |
| ServiceNow | 5 | IT service management |

### Finance

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Stripe | 5 | Payments, subscriptions |
| QuickBooks | 4 | Accounting |
| Xero | 4 | Accounting |

### Marketing

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Mailchimp | 4 | Email marketing |
| Shopify | 5 | E-commerce |
| Twitter/X | 4 | Social media |

### Design

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Figma | 4 | Design files, comments |

### AI Providers

| Integration | Tools | Capabilities |
|-------------|-------|--------------|
| Anthropic | 2 | Claude models |

## Project Structure

When you add an integration, Veryfront generates the following files:

```
my-project/
├── ai/tools/                    # AI tools
│   ├── list-emails.ts
│   ├── send-email.ts
│   └── search-emails.ts
├── app/api/auth/gmail/          # OAuth routes
│   ├── route.ts                 # Initiates auth flow
│   └── callback/route.ts        # Handles OAuth callback
└── lib/
    ├── gmail-client.ts          # API client
    └── token-store.ts           # Token management
```

## Configure OAuth

### Google Services

**Applies to:** Gmail, Calendar, Drive, Sheets, Docs

1. Open the [Google Cloud Console](https://console.cloud.google.com).
2. Create a project or select an existing one.
3. Navigate to **APIs & Services > Library**.
4. Enable the required APIs (Gmail API, Calendar API, etc.).
5. Go to **APIs & Services > Credentials**.
6. Click **Create Credentials > OAuth client ID**.
7. Set the application type to **Web application**.
8. Add the redirect URI: `http://localhost:3000/api/auth/{service}/callback`
9. Copy the client ID and secret.

Add to your `.env` file:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Microsoft Services

**Applies to:** Outlook, Teams, OneDrive, SharePoint

1. Open the [Azure Portal](https://portal.azure.com).
2. Navigate to **Azure Active Directory > App registrations**.
3. Click **New registration**.
4. Enter a name and select the supported account types.
5. Add the redirect URI: `http://localhost:3000/api/auth/{service}/callback`
6. Go to **API permissions** and add Microsoft Graph permissions.
7. Go to **Certificates & secrets** and create a client secret.

Add to your `.env` file:

```env
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
```

### Atlassian Services

**Applies to:** Jira, Confluence

1. Open the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/).
2. Click **Create > OAuth 2.0 integration**.
3. Configure the callback URL: `http://localhost:3000/api/auth/{service}/callback`
4. Add the required scopes for your integration.
5. Copy the client ID and secret.

Add to your `.env` file:

```env
ATLASSIAN_CLIENT_ID=your-client-id
ATLASSIAN_CLIENT_SECRET=your-client-secret
```

## Use Integration Tools

### Assign Tools to an Agent

Tools are auto-discovered from the `ai/tools/` directory. Assign them to agents using glob patterns:

```typescript
import { agent } from 'veryfront/agent';

const assistant = agent({
  model: "openai/gpt-4",
  system: "You help users manage their email and calendar.",
  tools: ["gmail/*", "calendar/*"],
});
```

### Combine Multiple Integrations

```typescript
const assistant = agent({
  model: "openai/gpt-4",
  tools: ["gmail/*", "slack/*", "notion/*"],
});
```

### Run the Agent

```typescript
const response = await assistant.generate("Summarize my unread emails");
console.log(response.text);
```

## Manage Tokens

Integrations use a shared token store to manage OAuth tokens securely.

### Token Store Configuration

```typescript
// lib/token-store.ts
import { TokenStore } from "veryfront/oauth";

export const tokenStore = new TokenStore({
  // Tokens are encrypted at rest
  // Automatic refresh before expiry
});
```

### Access Tokens in Tools

```typescript
import { tool } from 'veryfront/tool';
import { z } from "zod";
import { tokenStore } from "@/lib/token-store";

export const listEmails = tool({
  name: "list-emails",
  description: "List recent emails from the inbox",
  parameters: z.object({
    maxResults: z.number().default(10),
  }),
  execute: async ({ maxResults }, { userId }) => {
    const token = await tokenStore.get("gmail", userId);
    // Call Gmail API with token
  },
});
```

## Setup Wizard

After initializing a project with integrations, visit `/setup` in your browser for guided configuration:

1. **Environment Variables** - View required variables with links to provider documentation.
2. **OAuth App Setup** - Follow step-by-step instructions for each provider.
3. **Connection Test** - Verify that each integration authenticates successfully.
4. **Status Dashboard** - Monitor the status of connected services.

## Create Custom Integrations

Generate a new integration scaffold:

```bash
veryfront generate integration my-service
```

This creates:

```
src/cli/templates/integrations/my-service/
├── connector.json              # Integration metadata
└── files/
    ├── ai/tools/               # Tool definitions
    ├── app/api/auth/           # OAuth routes
    └── lib/
        └── my-service-client.ts
```

### Define the Connector

The `connector.json` file defines the integration metadata:

```json
{
  "name": "my-service",
  "displayName": "My Service",
  "description": "Connect to My Service API",
  "auth": {
    "type": "oauth2",
    "provider": "custom",
    "authorizationUrl": "https://my-service.com/oauth/authorize",
    "tokenUrl": "https://my-service.com/oauth/token",
    "scopes": ["read", "write"]
  },
  "envVars": [
    {
      "name": "MY_SERVICE_CLIENT_ID",
      "description": "OAuth Client ID",
      "required": true
    },
    {
      "name": "MY_SERVICE_CLIENT_SECRET",
      "description": "OAuth Client Secret",
      "required": true,
      "sensitive": true
    }
  ],
  "tools": [
    {
      "id": "get-data",
      "name": "Get Data",
      "description": "Retrieve data from My Service"
    }
  ]
}
```

### Connector Schema Reference

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier (lowercase, hyphenated) |
| `displayName` | string | Human-readable name |
| `description` | string | Brief description of the integration |
| `auth.type` | string | Authentication type (`oauth2`, `api-key`) |
| `auth.provider` | string | OAuth provider (`google`, `microsoft`, `atlassian`, `custom`) |
| `auth.authorizationUrl` | string | OAuth authorization endpoint |
| `auth.tokenUrl` | string | OAuth token endpoint |
| `auth.scopes` | string[] | Required OAuth scopes |
| `envVars` | array | Environment variables required |
| `tools` | array | AI tools provided by the integration |

## Best Practices

### Request Minimal Scopes

Only request the OAuth scopes your integration needs. This improves user trust and reduces security risk.

### Handle Token Expiry

The token store automatically refreshes tokens before expiry. If a refresh fails, prompt the user to re-authenticate.

### Provide Clear Error Messages

When API calls fail, return descriptive error messages that help users understand the issue.

### Respect Rate Limits

Implement exponential backoff when you encounter rate limit errors. Most APIs return a `Retry-After` header.

### Pass User Context

Always pass the user context to tools so the token store retrieves the correct credentials.

## Related Documentation

- [Agent Configuration](./agent.md) - Configure AI agents
- [Tools Reference](./tools.md) - Define custom tools
- [Hooks](./hooks.md) - React hooks for AI features
