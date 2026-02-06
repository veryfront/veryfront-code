# Figma Integration for Veryfront

A complete OAuth2-based integration for accessing Figma files, components, styles, and comments through AI tools.

## Overview

This integration enables AI assistants to:
- List and access Figma files across teams and projects
- Read file structure, components, and design systems
- Get and post comments for design feedback
- Extract component and style information
- Navigate team projects and file organization

## Features

### OAuth2 Authentication
- Secure OAuth2 flow with PKCE support
- Token management with refresh capability
- Team and project-level access

### AI Tools

1. **list-projects** - Browse team projects and files
   - List all projects in a team
   - Optional file listing per project
   - Recent file metadata

2. **list-files** - Discover Figma files
   - Browse files by team or project
   - Get file keys, names, thumbnails
   - Last modified timestamps

3. **get-file** - Deep file inspection
   - Complete file structure and metadata
   - Component extraction and documentation
   - Style system information
   - Page organization

4. **get-comments** - Read design feedback
   - Threaded comment retrieval
   - Filter by resolution status
   - Author and timestamp information
   - Comment location data

5. **post-comment** - Provide feedback
   - Post new comments or replies
   - Attach to specific nodes
   - Positioned annotations

## Setup

### 1. Create a Figma OAuth App

1. Go to [Figma Developers](https://www.figma.com/developers/apps)
2. Click "Create new app"
3. Configure your app:
   - **Name**: Your app name
   - **Callback URL**: `https://yourdomain.com/api/auth/figma/callback`
   - **Scopes**: `file_read` (required)

### 2. Configure Environment Variables

Add to your `.env`:

```bash
FIGMA_CLIENT_ID=your_figma_client_id
FIGMA_CLIENT_SECRET=your_figma_client_secret
```

### 3. Install the Integration

```bash
npx veryfront add figma
```

## File Structure

```
figma/
├── connector.json              # Integration configuration
├── files/
│   ├── _env.example           # Environment template
│   ├── lib/
│   │   ├── figma-client.ts    # Figma API client (353 lines)
│   │   ├── oauth.ts           # OAuth utilities (94 lines)
│   │   └── token-store.ts     # Token management (35 lines)
│   ├── app/api/auth/figma/
│   │   ├── route.ts           # OAuth initiation (14 lines)
│   │   └── callback/route.ts  # OAuth callback (44 lines)
│   └── tools/
│       ├── list-projects.ts   # Project listing (66 lines)
│       ├── list-files.ts      # File discovery (36 lines)
│       ├── get-file.ts        # File inspection (46 lines)
│       ├── get-comments.ts    # Comment reading (71 lines)
│       └── post-comment.ts    # Comment posting (47 lines)
└── README.md                  # This file
```

## API Client Features

### Type Safety
- Comprehensive TypeScript interfaces for all Figma API responses
- Strongly typed nodes, components, and styles
- Full type coverage for comments and projects

### Helper Functions
- `extractComponents()` - Parse component and component set data
- `extractStyles()` - Extract style information
- `findNodesByType()` - Traverse node tree by type
- `getFileSummary()` - Quick file statistics

### Error Handling
- Authentication state validation
- Detailed error messages from Figma API
- Automatic token refresh support (ready for implementation)

## Usage Examples

### Get File Information

```typescript
import { getFile, getFileSummary, extractComponents } from './lib/figma-client'

const file = await getFile('your-file-key')
const summary = getFileSummary(file)
const components = extractComponents(file)

console.log(`File: ${summary.name}`)
console.log(`Components: ${summary.componentCount}`)
console.log(`Styles: ${summary.styleCount}`)
```

### Post a Comment

```typescript
import { postComment } from './lib/figma-client'

await postComment('file-key', 'Great design!', {
  client_meta: {
    node_id: ['node-id'],
    x: 0.5,
    y: 0.5,
  }
})
```

### List Team Projects

```typescript
import { getTeamProjects, getProjectFiles } from './lib/figma-client'

const { projects } = await getTeamProjects('team-id')
for (const project of projects) {
  const { files } = await getProjectFiles(project.id)
  console.log(`${project.name}: ${files.length} files`)
}
```

## AI Prompt Examples

The integration includes pre-configured prompts:

- **Review a design** - Analyze file structure and provide feedback
- **Summarize comments** - Extract action items from comment threads
- **Extract components** - Document component library
- **Give design feedback** - Post structured feedback as comments

## Token Management

### Development Mode
Uses in-memory token storage (current implementation)

### Production Ready
Replace `token-store.ts` with a database-backed implementation:

```typescript
// Example with database
export async function setTokens(userId: string, data: TokenData) {
  await db.tokens.upsert({ userId, ...data })
}

export async function getAccessToken(userId: string) {
  const token = await db.tokens.findOne({ userId })
  return token?.accessToken
}
```

## Figma API Coverage

### Implemented Endpoints
- `GET /v1/me` - Current user
- `GET /v1/files/:key` - File data
- `GET /v1/files/:key/nodes` - Specific nodes
- `GET /v1/images/:key` - Export images
- `GET /v1/files/:key/comments` - Comments
- `POST /v1/files/:key/comments` - Post comment
- `GET /v1/teams/:id/projects` - Team projects
- `GET /v1/projects/:id/files` - Project files

### Future Enhancements
- File version history
- Component publishing
- Style management
- Team libraries
- Webhooks for file updates

## Integration Patterns

### Works Well With
- **Linear** - Link designs to issues
- **Slack** - Share design updates
- **Notion** - Document design decisions

### Suggested Workflows
1. Design review: Get file → Get comments → Post feedback
2. Component audit: Get file → Extract components → Document
3. Project overview: List projects → List files → Get summaries

## Technical Details

### Authentication Flow
1. User clicks "Connect Figma"
2. Redirects to `/api/auth/figma`
3. Figma OAuth authorization
4. Callback to `/api/auth/figma/callback`
5. Exchange code for access token
6. Store tokens securely
7. Ready for API calls

### Token Format
```typescript
{
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId: string
}
```

### Scope Requirements
- `file_read` - Required for all read operations
- Additional scopes can be added in `connector.json`

## Troubleshooting

### "Not authenticated" Error
- Verify OAuth flow completed successfully
- Check token storage implementation
- Ensure tokens haven't expired

### "Figma API error: 404"
- Verify file key is correct
- Ensure user has access to the file
- Check team/project IDs

### Rate Limiting
- Figma API has rate limits per OAuth app
- Implement exponential backoff for retries
- Cache file data when possible

## Development

### Running Tests
```bash
npm test
```

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

## Resources

- [Figma API Documentation](https://www.figma.com/developers/api)
- [OAuth App Setup](https://www.figma.com/developers/apps)
- [API Rate Limits](https://www.figma.com/developers/api#ratelimiting)
- [Component Documentation](https://help.figma.com/hc/en-us/articles/360038662654)

## License

Part of the Veryfront framework.
