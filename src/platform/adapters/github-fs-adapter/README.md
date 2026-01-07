# GitHub FS Adapter

Serves Veryfront projects directly from a GitHub repository. Read-only access via GitHub API.

## Configuration

```typescript
// veryfront.config.ts
export default {
  fs: {
    type: "github",
    github: {
      token: Deno.env.get("GITHUB_TOKEN"), // Required
      owner: "myorg", // Required
      repo: "myrepo", // Required
      ref: "main", // Optional (default: "main")
      cache: {
        enabled: true, // Optional (default: true)
        ttl: 60000, // Optional (default: 60s)
      },
    },
  },
};
```

## Environment Variables

| Variable       | Required | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `GITHUB_TOKEN` | Yes      | Personal Access Token with repo read access  |
| `GITHUB_OWNER` | No       | Repository owner (fallback if not in config) |
| `GITHUB_REPO`  | No       | Repository name (fallback if not in config)  |
| `GITHUB_REF`   | No       | Branch/tag/SHA (fallback, default: "main")   |

## How It Works

1. On initialization, fetches the full repository tree via Git Trees API
2. Builds an in-memory index of all files and directories
3. File reads use Contents API (or Blob API for files >1MB)
4. Results are cached with configurable TTL

## Rate Limits

GitHub API allows 5,000 requests/hour for authenticated requests. The adapter:

- Caches aggressively to minimize API calls
- Warns when approaching rate limit
- Includes rate limit info in errors

## Limitations

- **Read-only**: No write operations supported
- **Single repo**: One repository per adapter instance
- **No webhooks**: Cache invalidation is TTL-based only
