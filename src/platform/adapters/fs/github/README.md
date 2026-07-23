# GitHub filesystem adapter

The GitHub filesystem adapter provides read-only project access through the GitHub API.

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
        enabled: true,
        ttl: 60000,
        maxSize: 1000,
        maxMemory: 104857600,
      },
      retry: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        requestTimeout: 30000,
        totalTimeout: 120000,
        maxResponseBytes: 67108864,
      },
    },
  },
};
```

All cache durations, retry delays, and timeouts use milliseconds. `maxRetries` is the number of
retries after the initial request. `maxResponseBytes` limits each decoded GitHub API response.

## Environment variables

| Variable       | Required | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `GITHUB_TOKEN` | No       | Access token fallback when config omits one  |
| `GITHUB_OWNER` | No       | Repository owner (fallback if not in config) |
| `GITHUB_REPO`  | No       | Repository name (fallback if not in config)  |
| `GITHUB_REF`   | No       | Branch/tag/SHA (fallback, default: "main")   |

## Behavior

- Initialization fetches the repository tree and builds an in-memory file index.
- If GitHub truncates a recursive tree response, the adapter walks each subtree to build a
  complete index.
- File reads use the Contents API. Files larger than 1 MB use the Blob API.
- `refreshSourceSnapshot()` clears cached content and rebuilds the repository index.
- Requests retry transient failures up to `maxRetries`. Exponential backoff does not exceed
  `maxDelay`.
- A GitHub `Retry-After` value is a server-required minimum and can exceed `maxDelay`. The adapter
  fails instead of waiting when the delay does not fit within `totalTimeout`.
- Each request attempt aborts after `requestTimeout`.
- Each tree, content, or blob operation aborts after `totalTimeout`, including retries and tree
  traversal.
- Each successful response is cancelled when it exceeds `maxResponseBytes`.
- `GitHubApiClient` methods accept an optional `{ signal }` argument for caller cancellation.

## Rate limits

The adapter tracks GitHub rate-limit response headers. `getRateLimitInfo()` returns the most recent
valid limit, used and remaining request counts, and reset time. Invalid or incomplete headers are
ignored.

## Limitations

- The adapter is read-only.
- Each adapter instance accesses one repository and one configured ref.
- The adapter does not subscribe to repository webhooks.
