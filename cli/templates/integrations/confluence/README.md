# Confluence Integration for Veryfront

A complete Confluence integration for Veryfront that enables AI agents to
search, read, create, and update documentation in Confluence spaces.

## Features

- **OAuth 2.0 Authentication**: Secure authentication using Atlassian's OAuth
  2.0 flow
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
│   │   ├── oauth-store.ts                  # Fail-closed store binding
│   │   ├── oauth-store-registry.ts         # Durable store injection contract
│   │   ├── atlassian-oauth.generated.ts    # Selected configs and scope union
│   │   └── user-id.ts                      # Verified identity binding
│   ├── app/api/auth/confluence/route.ts     # OAuth initialization endpoint
│   ├── app/api/auth/atlassian/callback/
│   │   └── route.ts                        # Shared Atlassian callback handler
│   └── tools/
│       ├── confluence-search-content.ts               # Search tool
│       ├── confluence-get-page.ts                     # Get page content tool
│       ├── confluence-create-page.ts                  # Create page tool
│       ├── confluence-update-page.ts                  # Update page tool
│       └── confluence-list-spaces.ts                  # List spaces tool
```

## Setup

### 1. Create an Atlassian OAuth 2.0 App

1. Go to
   [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Click "Create" → "OAuth 2.0 integration"
3. Name your app (e.g., "Veryfront Confluence Integration")
4. Add the following settings:
   - **Grant type**: choose account-level for permitted sites across the
     account, or resource-level to limit the grant to sites selected during
     consent
   - **Callback URL**: `https://your-domain.com/api/auth/atlassian/callback`
   - **Scopes**:
     - `read:confluence-content.all`
     - `write:confluence-content`
     - `read:confluence-space.summary`
     - `read:confluence-user`
     - `search:confluence`
     - `read:page:confluence`
     - `write:page:confluence`
     - `offline_access` (for refresh tokens)

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
ATLASSIAN_CLIENT_ID=your_client_id_here
ATLASSIAN_CLIENT_SECRET=your_client_secret_here
# Required only when the authenticated user can access multiple Confluence sites:
CONFLUENCE_CLOUD_ID=your_atlassian_site_id
```

### 3. Install the Integration

Use the Veryfront CLI to install:

```bash
veryfront add integration confluence
```

## API Client Usage

Create the client inside an authenticated tool or server handler. Never use a
shared or placeholder user id:

```typescript
import type { ToolExecutionContext } from "veryfront/tool";
import { createConfluenceClient } from "./lib/confluence-client.ts";
import { requireUserIdFromContext } from "./lib/user-id.ts";

function confluenceFor(context: ToolExecutionContext) {
  return createConfluenceClient(requireUserIdFromContext(context));
}
```

### Search Content

```typescript
const results = await confluenceFor(context).searchContent("API documentation", {
  spaceKey: "DEV",
  limit: 10,
});
```

### Get Page Content

```typescript
const confluence = confluenceFor(context);
const page = await confluence.getPageContent("page-id-here");
const plainText = confluence.extractPlainText(page.body?.storage?.value || "");
```

### Create Page

```typescript
const newPage = await confluenceFor(context).createPage({
  spaceKey: "TEAM",
  title: "Meeting Notes",
  content: "<p>Meeting notes content here</p>",
  parentId: "optional-parent-page-id",
});
```

### Update Page

```typescript
const confluence = confluenceFor(context);
const currentPage = await confluence.getPage("page-id");
const updated = await confluence.updatePage("page-id", {
  title: currentPage.title,
  content: "<p>Updated content</p>",
  version: currentPage.version.number + 1,
  versionMessage: "Updated via API",
});
```

### List Spaces

```typescript
const spaces = await confluenceFor(context).listSpaces({
  type: "global",
  limit: 25,
});
```

## AI Tools

### confluence-search-content

Search for pages and blog posts in Confluence.

**Parameters:**

- `query` (string): Search query
- `spaceKey` (string, optional): Limit to specific space
- `limit` (number, default: 10): Max results

### confluence-get-page

Get the full content of a Confluence page.

**Parameters:**

- `pageId` (string): The page ID to retrieve

### confluence-create-page

Create a new page in a Confluence space.

**Parameters:**

- `spaceKey` (string): Space key (e.g., "TEAM")
- `title` (string): Page title
- `content` (string): Page content (plain text or HTML)
- `parentId` (string, optional): Parent page ID
- `type` (enum, default: "page"): "page" or "blogpost"

### confluence-update-page

Update an existing Confluence page.

**Parameters:**

- `pageId` (string): Page ID to update
- `title` (string, optional): New title
- `content` (string, optional): New content
- `versionMessage` (string, optional): Version change message

### confluence-list-spaces

List all accessible Confluence spaces.

**Parameters:**

- `type` (enum, default: "all"): "global", "personal", or "all"
- `limit` (number, default: 25): Max spaces to return

## Authentication Flow

1. User navigates to `/api/auth/confluence`
2. OAuth flow redirects to Atlassian authorization page
3. User approves access to their Confluence site
4. Atlassian redirects to `/api/auth/atlassian/callback`
5. Callback exchanges code for access token
6. System retrieves accessible Confluence sites (cloud IDs)
7. Tokens stored in the installed application OAuth store
8. User redirected to application home page

## Token Storage

Production refuses to load OAuth routes until application instrumentation has
installed a durable `ApplicationOAuthTokenStore` and a verified session/JWT
identity resolver. The store owns per-user encrypted tokens, one-shot state,
revisioned compare-and-set, and a bounded distributed refresh lease. The shared
`OAuthService` owns expiration checks and refresh.

Jira and Confluence share one Atlassian grant and one physical token row.
Selecting both products makes either initialization route request the
deduplicated union of their scopes. Changing the selected product set,
including removing a product, requires updating the app scopes, revoking the
old grant, deleting the shared `atlassian` row, and consenting again.

Projects generated with separate Jira and Confluence callbacks must revoke the
old Atlassian grant, delete the legacy `jira` and `confluence` token rows,
register `/api/auth/atlassian/callback`, and consent once again. Legacy refresh
tokens are not migrated automatically.

The generated template has no disconnect endpoint. A custom disconnect handler
using either logical service ID clears the shared row through the generated
alias; otherwise revoke the grant and remove the row through the application's
storage administration path.

## API Details

- **Base URL**: `https://api.atlassian.com/ex/confluence/{cloudId}`
- **API Version**: Confluence Cloud REST API v2 for spaces/pages/blogposts,
  with the documented v1 search endpoint where Confluence has no v2 equivalent
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

- Shares OAuth credentials with Jira integration (`ATLASSIAN_CLIENT_ID` and
  `ATLASSIAN_CLIENT_SECRET`)
- Requires OAuth app to have Confluence API access enabled
- Supports both Confluence Cloud and multi-site access
- Supports account-level and resource-level grants; the latter can access only
  sites selected during consent
- Automatically uses the only accessible site; multi-site users must configure
  and authorize `CONFLUENCE_CLOUD_ID`

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
2. Keep the generated state validation and verified identity resolver enabled
3. Use HTTPS for all API calls
4. Validate all user inputs
5. Install a durable, encrypted `ApplicationOAuthTokenStore` in production
6. Preserve revisioned refresh and the distributed refresh lease contract
