# Anthropic Admin Integration

A complete integration with the Anthropic Admin API for organization management, usage tracking, and workspace administration.

## Overview

This integration provides AI-powered tools to interact with the Anthropic Admin API, enabling you to:

- List and manage workspaces
- Monitor API usage and costs
- Manage API keys
- View organization members
- Access organization settings

## Files Created

### Configuration
- **connector.json** - Integration metadata with setup guide
- **files/_env.example** - Environment variable template

### API Client
- **files/lib/anthropic-admin-client.ts** - Fully typed TypeScript client for Anthropic Admin API
  - `AnthropicAdminClient` class with methods for all API endpoints
  - Strong TypeScript interfaces for all response types
  - Comprehensive error handling with custom `AnthropicAdminError`
  - Singleton pattern with `getAnthropicAdminClient()`

### AI Tools
All tools use `import { tool } from 'veryfront/tool'` and Zod schemas:

- **files/tools/list-workspaces.ts** - List all workspaces in the organization
- **files/tools/get-usage.ts** - Get API usage statistics with filtering options
- **files/tools/list-api-keys.ts** - List API keys for organization or workspace
- **files/tools/list-members.ts** - List organization members with role breakdown
- **files/tools/get-organization.ts** - Get organization details and settings

## Setup

1. Get an admin API key from https://console.anthropic.com
2. Add to your `.env` file:
   ```
   ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-your-key-here
   ```

3. Install the integration via Veryfront CLI (when available)

## API Client Features

### Strong TypeScript Types

```typescript
interface AnthropicWorkspace {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
}

interface AnthropicUsageRecord {
  workspace_id: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  total_cost_usd: number;
}
```

### Error Handling

Custom `AnthropicAdminError` class with:
- Error message
- HTTP status code
- Raw API response

### Usage Examples

```typescript
import { getAnthropicAdminClient } from './lib/anthropic-admin-client';

// List workspaces
const client = getAnthropicAdminClient();
const { workspaces } = await client.listWorkspaces();

// Get usage for date range
const usage = await client.getUsage({
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  workspaceId: 'ws-123',
  model: 'claude-3-opus-20240229',
  granularity: 'day'
});

// List API keys
const { api_keys } = await client.listAPIKeys('ws-123');

// Get organization details
const org = await client.getOrganization();
```

## AI Tools Features

All tools return structured responses with:
- `success` boolean
- `message` string description
- Relevant data fields
- Error information on failure
- Summary statistics where applicable

### Example Tool Response

```typescript
{
  success: true,
  usage: [...],
  summary: {
    total_cost_usd: 45.67,
    total_input_tokens: 123456,
    total_output_tokens: 78901,
    record_count: 31,
    date_range: {
      start: '2025-01-01',
      end: '2025-01-31'
    }
  },
  message: "Retrieved 31 usage record(s) totaling $45.67 USD"
}
```

## Authentication

This integration uses API key authentication. No OAuth flow required.

- Admin keys provide full access to organization management
- Keys should start with `sk-ant-`
- Store securely and never commit to version control

## Security Considerations

- Admin API keys have full organization access
- Consider using workspace-specific keys with limited permissions for production
- Keys can be revoked at any time via the Anthropic Console
- The API client validates key format on initialization

## Rate Limits

All endpoints are subject to Anthropic's rate limits. See https://docs.anthropic.com/en/api/rate-limits

## Documentation

Official Anthropic Admin API docs: https://docs.anthropic.com/en/api/admin-api

## Directory Structure

```
anthropic/
├── connector.json                    # Integration metadata
├── README.md                         # This file
└── files/
    ├── _env.example                  # Environment template
    ├── lib/
    │   └── anthropic-admin-client.ts # API client
    └── ai/
        └── tools/
            ├── list-workspaces.ts    # Workspace listing
            ├── get-usage.ts          # Usage statistics
            ├── list-api-keys.ts      # API key management
            ├── list-members.ts       # Member listing
            └── get-organization.ts   # Organization details
```

## TypeScript Features

- Strict type checking throughout
- Comprehensive interfaces for all API responses
- Generic request method with type parameters
- Proper error type guards
- TSDoc comments for all public methods
- Utility types for optional parameters
