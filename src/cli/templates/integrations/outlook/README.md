# Microsoft Outlook Integration for Veryfront

Complete Microsoft Outlook integration following the veryfront integration pattern.

## Features

- OAuth 2.0 authentication with Microsoft Graph API
- Read, send, and manage Outlook emails
- Search emails across all folders
- List and organize mail folders
- Full TypeScript type safety

## Setup Instructions

### 1. Create Azure App Registration

1. Go to [Azure Portal - App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click "New registration"
3. Enter application details:
   - Name: Your app name (e.g., "Veryfront Outlook Integration")
   - Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
   - Redirect URI: `http://localhost:3000/api/auth/outlook/callback` (adjust for your domain)
4. Click "Register"

### 2. Configure App Credentials

1. Note the "Application (client) ID" - this is your `MICROSOFT_CLIENT_ID`
2. Go to "Certificates & secrets"
3. Click "New client secret"
4. Add a description and expiration period
5. Copy the secret value - this is your `MICROSOFT_CLIENT_SECRET`

### 3. Set API Permissions

1. Go to "API permissions"
2. Click "Add a permission" → "Microsoft Graph" → "Delegated permissions"
3. Add these permissions:
   - `Mail.Read` - Read user mail
   - `Mail.Send` - Send mail as a user
   - `Mail.ReadWrite` - Read and write access to user mail
   - `offline_access` - Maintain access to data you have given it access to
4. Click "Grant admin consent" (if available)

### 4. Add Environment Variables

Add to your `.env` file:

```bash
MICROSOFT_CLIENT_ID=your_client_id_here
MICROSOFT_CLIENT_SECRET=your_client_secret_here
```

## File Structure

```
outlook/
├── connector.json                    # Integration configuration
├── files/
│   ├── _env.example                 # Example environment variables
│   ├── lib/
│   │   ├── oauth.ts                 # OAuth flow utilities
│   │   ├── outlook-client.ts        # Microsoft Graph API client
│   │   └── token-store.ts           # Token storage (in-memory)
│   ├── app/api/auth/outlook/
│   │   ├── route.ts                 # OAuth initiation
│   │   └── callback/route.ts        # OAuth callback handler
│   └── ai/tools/
│       ├── list-emails.ts           # List recent emails
│       ├── get-email.ts             # Get email details
│       ├── send-email.ts            # Send email
│       ├── search-emails.ts         # Search emails
│       └── list-folders.ts          # List mail folders
```

## API Client (`outlook-client.ts`)

### Functions

#### `listEmails(options?)`
List emails from inbox or specific folder.
- `folderId?: string` - Folder ID (default: inbox)
- `top?: number` - Max results
- `skip?: number` - Pagination offset
- `filter?: string` - OData filter
- `orderBy?: string` - Sort order

#### `getEmail(messageId: string)`
Get detailed email information including full body.

#### `sendEmail(options: SendEmailOptions)`
Send a new email message.
- `to: string[]` - Recipients
- `subject: string` - Subject line
- `body: string` - Email body
- `cc?: string[]` - CC recipients
- `bcc?: string[]` - BCC recipients
- `importance?: 'low' | 'normal' | 'high'`
- `bodyType?: 'text' | 'html'`

#### `searchEmails(options)`
Search emails by query string.
- `query: string` - Search query
- `top?: number` - Max results
- `skip?: number` - Pagination offset

#### `listFolders()`
List all mail folders in the mailbox.

#### Helper Functions
- `markAsRead(messageId: string)`
- `markAsUnread(messageId: string)`
- `deleteEmail(messageId: string)`
- `moveEmail(messageId: string, destinationFolderId: string)`
- `formatEmail(message: OutlookMessage)` - Format for display

## AI Tools

### 1. `list-emails`
List recent emails from inbox or folder.

**Parameters:**
- `folderId?: string` - Folder ID
- `limit?: number` (1-50, default: 10) - Max emails
- `unreadOnly?: boolean` - Only unread emails
- `orderBy?: string` - Sort order

**Example:**
```typescript
{
  folderId: "inbox",
  limit: 20,
  unreadOnly: true,
  orderBy: "receivedDateTime desc"
}
```

### 2. `get-email`
Get detailed email information.

**Parameters:**
- `messageId: string` - Email ID
- `includeBody?: boolean` (default: true) - Include full body

**Example:**
```typescript
{
  messageId: "AAMkAGI2TG93AAA=",
  includeBody: true
}
```

### 3. `send-email`
Send a new email message.

**Parameters:**
- `to: string[]` - Recipient emails
- `subject: string` - Subject line
- `body: string` - Email body
- `cc?: string[]` - CC emails
- `bcc?: string[]` - BCC emails
- `importance?: 'low' | 'normal' | 'high'`
- `bodyType?: 'text' | 'html'`

**Example:**
```typescript
{
  to: ["user@example.com"],
  subject: "Meeting Follow-up",
  body: "Thank you for attending...",
  cc: ["manager@example.com"],
  importance: "high",
  bodyType: "text"
}
```

### 4. `search-emails`
Search emails across all fields.

**Parameters:**
- `query: string` - Search query
- `limit?: number` (1-50, default: 10) - Max results

**Example:**
```typescript
{
  query: "quarterly report",
  limit: 15
}
```

### 5. `list-folders`
List all mail folders.

**Parameters:** None

**Returns:** Array of folders with counts and metadata.

## OAuth Configuration

### Authorization URL
```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize
```

### Token URL
```
https://login.microsoftonline.com/common/oauth2/v2.0/token
```

### Scopes
- `Mail.Read` - Read user mail
- `Mail.Send` - Send mail
- `Mail.ReadWrite` - Full mail access
- `offline_access` - Refresh token

### Token Authentication
Uses `body` method (credentials sent in request body as form parameters).

## Usage Flow

1. User navigates to `/api/auth/outlook`
2. Redirected to Microsoft login
3. User authorizes application
4. Microsoft redirects to `/api/auth/outlook/callback` with code
5. Code exchanged for access token
6. Token stored (in-memory by default)
7. AI tools can now access Outlook data

## Production Considerations

### Token Storage
The default `token-store.ts` uses in-memory storage. For production:

1. Replace with database-backed storage
2. Implement token encryption
3. Support multiple users with session management
4. Implement token refresh logic

### Token Refresh
Access tokens expire after ~1 hour. Implement refresh logic:

```typescript
import { refreshAccessToken } from './oauth'
import { getRefreshToken, setTokens } from './token-store'

async function ensureValidToken() {
  const refreshToken = getRefreshToken()
  if (refreshToken) {
    const tokens = await refreshAccessToken(refreshToken)
    setTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    })
  }
}
```

### Security
- Store secrets in environment variables
- Use HTTPS in production
- Implement CSRF protection (state parameter)
- Validate redirect URIs
- Rate limit API calls

## Microsoft Graph API Resources

- [Microsoft Graph Documentation](https://docs.microsoft.com/graph/)
- [Mail API Reference](https://docs.microsoft.com/graph/api/resources/mail-api-overview)
- [Authentication Guide](https://docs.microsoft.com/graph/auth/)
- [OAuth 2.0 Flow](https://docs.microsoft.com/azure/active-directory/develop/v2-oauth2-auth-code-flow)

## Troubleshooting

### Common Issues

**"Not authenticated" error**
- Verify OAuth flow completed successfully
- Check token storage is working
- Ensure tokens haven't expired

**"Insufficient permissions" error**
- Verify all required scopes are requested
- Check admin consent was granted
- Ensure API permissions are enabled in Azure

**"Invalid client" error**
- Verify `MICROSOFT_CLIENT_ID` is correct
- Check `MICROSOFT_CLIENT_SECRET` is valid
- Ensure redirect URI matches Azure configuration

## Testing

To test the integration:

1. Start your development server
2. Navigate to `/api/auth/outlook`
3. Complete Microsoft OAuth flow
4. Test AI tools via chat interface

Example prompts:
- "List my recent emails"
- "Search for emails about project alpha"
- "Send an email to john@example.com"

## License

Part of the Veryfront framework.
