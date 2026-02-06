# Veryfront Renderer

Deno-based React meta-framework with SSR/RSC and AI-native capabilities.

## Commands

See `deno.json` for all tasks. Key ones:

```bash
deno task dev        # Development server
deno task test       # Run tests
deno task verify     # Full CI check
```

## Architecture

See `src/README.md` for module documentation.

## Imports

Use `#veryfront/*` for internal imports:
```typescript
import { foo } from "#veryfront/utils";
```

## Environment Variables

```bash
VERYFRONT_DEBUG=1              # Enable debug logging
PROXY_MODE=1                   # Enable proxy mode
VERYFRONT_API_TOKEN=vf_...     # API token
VERYFRONT_PROJECT_SLUG=...     # Project slug
PRODUCTION_MODE=1              # Production mode
```

## Testing

```typescript
// Use withTestContext for automatic cleanup
await withTestContext("my-test", async (ctx) => {
  const server = await ctx.startDevServer({ port });
});
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Module not found | Clear `.cache/` |
| Test timeout | Check for hanging promises |
| Port in use | `lsof -i :3001` |
