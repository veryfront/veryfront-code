# Service Integration Setup Guide

This guide will help you set up OAuth credentials for your AI agent's service integrations.

## Quick Start

1. Start the development server: `veryfront dev`
2. Visit `http://localhost:3000/setup` for an interactive setup guide
3. Follow the step-by-step instructions for each service

## Service-Specific Setup

### Gmail & Google Calendar

Both Gmail and Calendar use Google OAuth. You only need one set of credentials.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Enable APIs:
   - Gmail API
   - Google Calendar API
4. Create OAuth 2.0 credentials:
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/gmail/callback`
     - `http://localhost:3000/api/auth/calendar/callback`
5. Copy credentials to `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### Slack

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App" > "From scratch"
3. Add OAuth scopes under "OAuth & Permissions":
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `users:read` - View users
4. Add redirect URL:
   - `http://localhost:3000/api/auth/slack/callback`
5. Install to your workspace
6. Copy credentials to `.env`:
   ```
   SLACK_CLIENT_ID=your-client-id
   SLACK_CLIENT_SECRET=your-client-secret
   ```

### GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the form:
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
4. Copy credentials to `.env`:
   ```
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   ```

### Jira (Atlassian)

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Create a new OAuth 2.0 integration
3. Add required scopes:
   - `read:jira-work`
   - `write:jira-work`
4. Set callback URL:
   - `http://localhost:3000/api/auth/jira/callback`
5. Copy credentials to `.env`:
   ```
   JIRA_CLIENT_ID=your-client-id
   JIRA_CLIENT_SECRET=your-client-secret
   JIRA_CLOUD_ID=your-atlassian-cloud-id
   ```

### Notion

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Configure:
   - Name: Your app name
   - Associated workspace: Select your workspace
   - Capabilities: Select required capabilities
4. Copy the Internal Integration Token to `.env`:
   ```
   NOTION_API_KEY=your-integration-token
   ```
5. **Important**: Share the pages you want to access with your integration

## Testing Connections

After setting up credentials:

1. Start the dev server: `veryfront dev`
2. Visit each connection URL to authorize:
   - Gmail: `http://localhost:3000/api/auth/gmail`
   - Slack: `http://localhost:3000/api/auth/slack`
   - Calendar: `http://localhost:3000/api/auth/calendar`
   - GitHub: `http://localhost:3000/api/auth/github`
3. Check connection status at `http://localhost:3000/setup`

## Troubleshooting

### "Invalid redirect URI" error
- Make sure the callback URL in your OAuth app matches exactly
- Include the full path: `/api/auth/{service}/callback`

### "Access denied" error
- Check that all required scopes are added
- For Slack, ensure the app is installed to your workspace

### Tokens expire
- Tokens are stored in memory by default (reset on server restart)
- For production, implement persistent storage in `lib/token-store.ts`

## Production Deployment

Before deploying:

1. Update redirect URIs to your production domain
2. Implement persistent token storage (database/KV)
3. Add proper error handling and logging
4. Consider rate limiting for API calls

## Need Help?

- Check the interactive setup guide at `/setup`
- Review the API documentation for each service
- Ensure environment variables are properly set
