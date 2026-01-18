# Coding Agent Example

A powerful AI coding assistant built with Veryfront AI framework that can:

- Read and write files in your project
- Search your codebase for patterns
- Search the web for documentation and examples
- Execute shell commands (platform-dependent)

## Features

### File Operations (All Platforms)

- **Read files**: Get content from any file in the project
- **Write files**: Create or update files
- **List directories**: Browse project structure
- **Search files**: Find patterns using regex
- **Create/delete**: Manage directories and files

### Web Capabilities (All Platforms)

- **Web search**: Search the web using Brave Search API
- **Fetch webpages**: Read content from URLs

### Command Execution (Real Filesystem Only)

- **Run commands**: Execute shell commands like tests, builds, git operations
- Note: Not available on Cloudflare Workers or other virtual FS platforms

## Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Add your API keys:**
   ```bash
   # Required: Anthropic API key
   ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

   # Optional: Brave Search API key (for web search)
   BRAVE_SEARCH_API_KEY=your-brave-api-key-here
   ```

   Get your API keys:
   - Anthropic: https://console.anthropic.com/
   - Brave Search: https://brave.com/search/api/ (2000 free queries/month)

3. **Start the development server:**
   ```bash
   deno run --allow-all ../../src/cli/main.ts dev
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Example Prompts

### File Operations

- "List all TypeScript files in the src directory"
- "Read the contents of package.json"
- "Create a new file called utils/helper.ts with a function that capitalizes strings"
- "Search for all TODO comments in the codebase"

### Web Search

- "Search the web for React 19 new features"
- "Find the latest Deno documentation for HTTP servers"
- "Look up common TypeScript error TS2307"

### Command Execution (if available)

- "Run the tests using deno test"
- "Check git status"
- "Build the project"

### Combined Workflows

- "Search the web for Zod validation examples, then create a validation schema in lib/schema.ts"
- "Read the README.md file and suggest improvements based on best practices you find online"
- "List all files, then search for any console.log statements that should be removed"

## Architecture

```
coding-agent/
├── ai/
│   ├── tools/                 # Auto-discovered tools
│   │   ├── read-file.ts       # Read file contents
│   │   ├── write-file.ts      # Write/update files
│   │   ├── list-files.ts      # List directory contents
│   │   └── web-search.ts      # Search the web
│   └── utils/
│       └── path-helpers.ts    # Shared utilities
├── app/
│   ├── api/agent/route.ts    # API endpoint with autodiscovery
│   └── page.tsx               # Chat UI
├── veryfront.config.ts        # Required: Import map configuration
├── .env.example               # Environment template
└── README.md                  # This file
```

### Configuration

This example requires `veryfront.config.ts` to configure import resolution for API routes:

```typescript
import { defineConfig } from "../../src/core/config/index.ts";

export default defineConfig({
  router: "app",

  // Required for API routes to resolve Veryfront framework imports
  resolve: {
    importMap: {
      imports: {
        "veryfront/agent": "../../src/agent/index.ts",
        "veryfront/tool": "../../src/tool/index.ts",
        "veryfront/mcp": "../../src/mcp/index.ts",
        "veryfront/provider": "../../src/provider/index.ts",
      },
    },
  },

  security: {
    cors: true,
  },
});
```

The Import Map Plugin (at `src/routing/api/module-loader/loader.ts:35-184`) uses this configuration to resolve bare imports like `'veryfront/agent'` during API route bundling. It uses `RuntimeAdapter.fs.readFile()` for file loading, which works with both real and virtual filesystems.

## How It Works

1. **Tool Autodiscovery**: Tools in `ai/tools/` are automatically discovered and registered using `discoverAll()`. Each tool exports a default `tool()` definition.

2. **Convention-based IDs**: Tool filenames become IDs (e.g., `read-file.ts` → `readFile`). Reference them in your agent with `tools: { readFile: true }`.

3. **API Route** (`app/api/agent/route.ts`): Calls `discoverAll()` to register tools, then creates an agent that references them by ID. Streams responses using Server-Sent Events (SSE).

4. **Frontend** (`app/page.tsx`): React component that provides a chat interface and handles SSE streaming.

### Benefits of Autodiscovery

- **Zero Configuration**: Just create files in `ai/tools/` - no manual imports needed
- **Convention-based**: Filenames automatically become tool IDs
- **Scalable**: Add new tools without updating agent configuration
- **MCP Compatible**: All discovered tools are automatically exposed via MCP protocol

## Virtual Filesystem Support

This example works with Veryfront's virtual filesystem adapter! All file operations use the `RuntimeAdapter`, which means:

- ✅ Works with real filesystem (Deno, Node, Bun)
- ✅ Works with virtual filesystem (in-memory)
- ✅ Works with remote filesystem (HTTP-based)

Command execution (`runCommand`) only works on platforms with real filesystems.

## Production Considerations

### Security

- The agent has full read/write access to your project - use with caution
- Consider implementing permission prompts for destructive operations
- In production, restrict file access to specific directories

### Rate Limiting

Consider adding rate limiting using Veryfront's production features:

```typescript
import { rateLimitMiddleware } from "veryfront/agent/middleware";

const agent = agent({
  // ... config
  middleware: [
    rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }),
  ],
});
```

### Caching

Enable caching to reduce costs:

```typescript
import { cacheMiddleware } from "veryfront/agent/middleware";

const agent = agent({
  // ... config
  middleware: [
    cacheMiddleware({ ttl: 3600 }),
  ],
});
```

### Cost Tracking

Track API usage:

```typescript
import { costTrackingMiddleware } from "veryfront/agent/middleware";

const agent = agent({
  // ... config
  middleware: [
    costTrackingMiddleware(),
  ],
});
```

## Learn More

- [Veryfront AI Documentation](https://veryfront.com/docs/ai)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Brave Search API](https://brave.com/search/api/)

## License

MIT
