# Confluence Integration for Veryfront

A complete Confluence integration for Veryfront that enables AI agents to search, read, create, and update documentation in Confluence spaces.

## Features

- **OAuth 2.0 Authentication**: Secure authentication using Atlassian's OAuth 2.0 flow
- **Search Content**: Search for pages and blog posts across Confluence spaces
- **Read Pages**: Retrieve full page content with metadata
- **Create Pages**: Create new pages in any accessible space
- **Update Pages**: Update existing pages with version control
- **List Spaces**: Discover all accessible Confluence spaces

## Structure

```
confluence/
├── connector.json                           # Integration metadata and configuration
├── files/
│   ├── _env.example                        # Environment variables template
│   ├── lib/
│   │   ├── confluence-client.ts            # Confluence API client
│   │   ├── oauth.ts                        # OAuth 2.0 utilities
│   │   └── token-store.ts                  # Token management (in-memory)
│   ├── app/api/auth/confluence/
│   │   ├── route.ts                        # OAuth initialization endpoint
│   │   └── callback/route.ts               # OAuth callback handler
│   └── tools/
│       ├── search-content.ts               # Search tool
│       ├── get-page.ts                     # Get page content tool
│       ├── create-page.ts                  # Create page tool
│       ├── update-page.ts                  # Update page tool
│       └── list-spaces.ts                  # List spaces tool
```

## Setup

### 1. Create an Atlassian OAuth 2.0 App

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Click "Create" → "OAuth 2.0 integration"
3. Name your app (e.g., "Veryfront Confluence Integration")
4. Add the following settings:
   - **Callback URL**: `https://your-domain.com/api/auth/confluence/callback`
   - **Scopes**:
     - `read:confluence-content.all`
     - `write:confluence-content`
     - `offline_access` (for refresh tokens)

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
ATLASSIAN_CLIENT_ID=your_client_id_here
ATLASSIAN_CLIENT_SECRET=your_client_secret_here
```

### 3. Install the Integration

Use the Veryfront CLI to install:

```bash
veryfront add integration confluence
```

## API Client Usage

### Search Content

```typescript
import { searchContent } from './lib/confluence-client.ts'

const results = await searchContent('API documentation', {
  spaceKey: 'DEV',
  limit: 10
})
```

### Get Page Content

```typescript
import { getPageContent, extractPlainText } from './lib/confluence-client.ts'

const page = await getPageContent('page-id-here')
const plainText = extractPlainText(page.body?.storage?.value || '')
```

### Create Page

```typescript
import { createPage } from './lib/confluence-client.ts'

const newPage = await createPage({
  spaceKey: 'TEAM',
  title: 'Meeting Notes',
  content: '<p>Meeting notes content here</p>',
  parentId: 'optional-parent-page-id'
})
```

### Update Page

```typescript
import { updatePage, getPage } from './lib/confluence-client.ts'

const currentPage = await getPage('page-id')
const updated = await updatePage('page-id', {
  content: '<p>Updated content</p>',
  version: currentPage.version.number + 1,
  versionMessage: 'Updated via API'
})
```

### List Spaces

```typescript
import { listSpaces } from './lib/confluence-client.ts'

const spaces = await listSpaces({
  type: 'global',
  limit: 25
})
```

## AI Tools

### search-content

Search for pages and blog posts in Confluence.

**Parameters:**
- `query` (string): Search query
- `spaceKey` (string, optional): Limit to specific space
- `limit` (number, default: 10): Max results

### get-page

Get the full content of a Confluence page.

**Parameters:**
- `pageId` (string): The page ID to retrieve

### create-page

Create a new page in a Confluence space.

**Parameters:**
- `spaceKey` (string): Space key (e.g., "TEAM")
- `title` (string): Page title
- `content` (string): Page content (plain text or HTML)
- `parentId` (string, optional): Parent page ID
- `type` (enum, default: "page"): "page" or "blogpost"

### update-page

Update an existing Confluence page.

**Parameters:**
- `pageId` (string): Page ID to update
- `title` (string, optional): New title
- `content` (string, optional): New content
- `versionMessage` (string, optional): Version change message

### list-spaces

List all accessible Confluence spaces.

**Parameters:**
- `type` (enum, default: "all"): "global", "personal", or "all"
- `limit` (number, default: 25): Max spaces to return

## Authentication Flow

1. User navigates to `/api/auth/confluence`
2. OAuth flow redirects to Atlassian authorization page
3. User approves access to their Confluence site
4. Atlassian redirects to `/api/auth/confluence/callback`
5. Callback exchanges code for access token
6. System retrieves accessible Confluence sites (cloud IDs)
7. Tokens stored in token store (in-memory by default)
8. User redirected to application home page

## Token Storage

The default implementation uses an in-memory token store suitable for development. For production:

1. Implement a database-backed token store
2. Store tokens per user
3. Handle token refresh with `refresh_token`
4. Implement proper token expiration checks

## API Details

- **Base URL**: `https://api.atlassian.com/ex/confluence/{cloudId}`
- **API Version**: Confluence Cloud REST API v1
- **Authentication**: Bearer token
- **Rate Limits**: Respect Atlassian API rate limits

## Content Format

Confluence uses "storage format" (XHTML) for content:

- **Plain text**: Automatically converted using `formatAsStorage()`
- **HTML**: Use Confluence storage format directly
- **Reading**: Use `extractPlainText()` to convert to plain text

## Suggested Integrations

This integration works well with:
- **Jira**: Link documentation to issues
- **Slack**: Share documentation in channels
- **Notion**: Sync documentation between platforms

## Notes

- Shares OAuth credentials with Jira integration (`ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`)
- Requires OAuth app to have Confluence API access enabled
- Supports both Confluence Cloud and multi-site access
- Uses the first accessible site by default (can be extended for multi-site support)

## TypeScript

All files are strongly typed with detailed TypeScript interfaces:

- `ConfluenceSpace`: Space metadata
- `ConfluencePage`: Page structure and content
- `ConfluenceSearchResult`: Search result format
- `AtlassianTokenResponse`: OAuth token response
- `AtlassianResource`: Accessible site information

## Error Handling

All API calls include proper error handling:
- Authentication errors: "Not authenticated" message
- API errors: Include status code and error message
- Token exchange errors: Detailed OAuth error messages

## Security Considerations

1. Store credentials securely (use environment variables)
2. Implement CSRF protection (state parameter in OAuth)
3. Use HTTPS for all API calls
4. Validate all user inputs
5. Implement proper token storage in production
6. Handle token expiration and refresh
