# Microsoft Teams Integration for Veryfront

This integration enables AI agents to interact with Microsoft Teams, allowing them to read chats, send messages, and manage team channels.

## Features

- **List Chats**: Retrieve recent Teams chats with filtering options
- **Get Messages**: Read messages from specific chats or channels
- **Send Messages**: Send messages to chats or team channels
- **List Teams**: Get all teams the user is a member of
- **List Channels**: List channels within a specific team

## Setup

### 1. Register an Azure Application

1. Go to the [Azure Portal](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click "New registration"
3. Enter a name for your application (e.g., "Veryfront Teams Integration")
4. Set the redirect URI to: `https://yourdomain.com/api/auth/teams/callback`
5. Click "Register"

### 2. Configure API Permissions

After registering your app:

1. Go to "API permissions" in the left sidebar
2. Click "Add a permission"
3. Select "Microsoft Graph"
4. Choose "Delegated permissions"
5. Add the following permissions:
   - `Chat.Read` - Read user chats
   - `Chat.ReadWrite` - Read and write user chats
   - `ChannelMessage.Send` - Send channel messages
   - `Team.ReadBasic.All` - Read team information
   - `offline_access` - Maintain access to data
6. Click "Grant admin consent" if required by your organization

### 3. Create a Client Secret

1. Go to "Certificates & secrets"
2. Click "New client secret"
3. Add a description and set expiration
4. Copy the secret value immediately (it won't be shown again)

### 4. Configure Environment Variables

Add the following to your `.env` file:

```bash
MICROSOFT_CLIENT_ID=your_application_id_here
MICROSOFT_CLIENT_SECRET=your_client_secret_here
```

## Usage

### Authentication

Users need to authenticate with Microsoft Teams before using the tools:

1. Navigate to `/api/auth/teams` in your application
2. Complete the Microsoft OAuth flow
3. You'll be redirected back to your application with access granted

### AI Tools

#### list-chats

List recent Teams chats:

```typescript
{
  limit: 20,              // Number of chats to return (1-50)
  expandMembers: false    // Include member information
}
```

Returns chat IDs, names, types, and timestamps.

#### get-messages

Get messages from a specific chat:

```typescript
{
  chatId: "19:...",       // Chat ID from list-chats
  limit: 20,              // Number of messages (1-50)
  includeHtml: false      // Include HTML formatted content
}
```

Returns message content, sender info, attachments, and reactions.

#### send-message

Send a message to a chat or channel:

**For Chats:**
```typescript
{
  chatId: "19:...",
  content: "Hello from the AI!",
  contentType: "text"     // "text" or "html"
}
```

**For Channels:**
```typescript
{
  teamId: "team-id",
  channelId: "channel-id",
  content: "Update: Project completed!",
  contentType: "text",
  subject: "Project Update"  // Optional
}
```

#### list-teams

List all teams the user has joined:

```typescript
{
  limit: 25               // Number of teams (1-50)
}
```

Returns team IDs, names, descriptions, and metadata.

#### list-channels

List channels in a specific team:

```typescript
{
  teamId: "team-id",
  limit: 25               // Number of channels (1-50)
}
```

Returns channel IDs, names, types, and links.

## API Client

The Teams client (`teams-client.ts`) provides typed methods for all Microsoft Graph API operations:

```typescript
import {
  listChats,
  getChatMessages,
  sendChatMessage,
  listTeams,
  listChannels,
  sendChannelMessage,
  getChatDisplayName,
  getPlainTextContent
} from "./lib/teams-client.ts";
```

### Key Methods

- `listChats(options)` - List user chats
- `getChatMessages(chatId, options)` - Get chat messages
- `sendChatMessage(chatId, content, contentType)` - Send chat message
- `listTeams(options)` - List joined teams
- `listChannels(teamId, options)` - List team channels
- `sendChannelMessage(teamId, channelId, content, contentType, subject)` - Send channel message
- `getCurrentUser()` - Get current user profile

### Helper Functions

- `getChatDisplayName(chat)` - Format chat display name
- `getPlainTextContent(message)` - Extract plain text from message

## Token Management

The integration uses an in-memory token store for development. For production:

1. Replace `token-store.ts` with a database-backed implementation
2. Store tokens securely with encryption
3. Implement token refresh logic using the `refreshAccessToken()` function in `oauth.ts`
4. Handle token expiration gracefully

## Security Considerations

- **Scopes**: Only request the minimum required permissions
- **Token Storage**: Use encrypted database storage in production
- **Token Refresh**: Implement automatic token refresh before expiration
- **CSRF Protection**: State parameter is included in OAuth flow
- **Environment Variables**: Keep client secrets secure and never commit them

## Integration with Other Services

This integration works well with:

- **Outlook**: Shared Microsoft OAuth credentials
- **Calendar**: Microsoft Calendar integration
- **Slack**: Cross-platform messaging
- **Gmail**: Email and chat integration

Set `suggestedWith` in connector.json to recommend related integrations.

## Troubleshooting

### Authentication Fails

- Verify client ID and secret are correct
- Check redirect URI matches Azure app configuration
- Ensure required API permissions are granted

### Cannot Read Messages

- Verify `Chat.Read` permission is granted
- Check user has access to the chat
- Ensure token hasn't expired

### Cannot Send Messages

- Verify `Chat.ReadWrite` or `ChannelMessage.Send` permissions
- Check user is a member of the chat/channel
- Ensure message content is not empty

### Token Expired

- Implement token refresh using `refreshAccessToken()` in `oauth.ts`
- Store refresh tokens securely
- Handle 401 responses by triggering re-authentication

## API Limits

Microsoft Graph API has rate limits:

- **Per-app limit**: 2000 requests per second
- **Per-user limit**: 50 requests per second
- **Concurrent requests**: 20 per user

Implement exponential backoff and retry logic for production use.

## TypeScript Types

All API responses are fully typed. Key interfaces:

- `TeamsChat` - Chat information
- `ChatMessage` - Message with content and metadata
- `Team` - Team information
- `Channel` - Channel information
- `ChatMember` - Member information

See `teams-client.ts` for complete type definitions.

## Resources

- [Microsoft Graph Teams API](https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview)
- [Azure App Registration](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
- [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
- [OAuth 2.0 Authorization](https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
