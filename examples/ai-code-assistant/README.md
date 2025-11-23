# AI Code Assistant

A production-ready AI code assistant built with Veryfront AI. Demonstrates
streaming, tool calling, MCP integration, middleware, and a beautiful chat UI.

## Features

### Backend

- **4 Auto-Discovered Tools**
  - `searchCode` - Search through codebase with pattern matching
  - `readFile` - Read file contents with line numbers
  - `listFiles` - Browse directory structure
  - `gitStatus` - Check git status and changes

- **Prompts & Resources**
  - Pre-configured system prompt for code assistance
  - Documentation resource for accessing project docs

- **Middleware**
  - Rate limiting
  - Response caching
  - Cost tracking
  - Security validation

### Frontend

- **Modern Chat UI**
  - Real-time streaming responses
  - Tool call visualization with JSON pretty-print
  - Code syntax highlighting
  - Responsive design with Tailwind CSS
  - Loading states and animations

### MCP Integration

- Auto-discovery of tools, prompts, and resources
- MCP server ready on port 3001
- JSON-RPC compatible

## Quick Start

```bash
# 1. Set your API key
export OPENAI_API_KEY=sk-your-key-here

# 2. Run the development server
deno run --allow-all ../../src/cli/main.ts dev --port 3002

# 3. Open http://localhost:3002
```

## Known Issues

### Module Server Required for React Hydration

The chat interface requires React hydration to become interactive. This depends
on a module server running on port 3012 to serve client-side React components.

**Issue**: Module server may not start automatically with `dev` command
**Impact**: Chat UI renders but remains static (button stays disabled)
**Error**: `ERR_CONNECTION_REFUSED` on `localhost:3012/pages/index.js`

**Workaround**: The module server should be integrated into the dev server. If
the chat is not interactive, check:

1. Browser console for module loading errors
2. Port 3012 availability: `lsof -i :3012`
3. Server logs for module server status

### CSP and Playwright Testing

Content Security Policy (CSP) with nonces is fully implemented and working.
However, Playwright's CSP enforcement may show false positive errors even when
nonces match correctly.

**Recommendation**: Test interactivity in a real browser (Chrome, Firefox,
Safari) rather than Playwright.

See `CSP_INVESTIGATION.md` for complete analysis of the CSP implementation.

## Project Structure

```
ai-code-assistant/
├── ai/                          # Auto-discovered AI components
│   ├── tools/                   # Tool definitions
│   │   ├── search-code.ts      # Code search tool
│   │   ├── read-file.ts        # File reader tool
│   │   ├── list-files.ts       # Directory listing tool
│   │   └── git-status.ts       # Git status tool
│   ├── prompts/                 # System prompts
│   │   └── code-assistant.ts   # Main assistant prompt
│   └── resources/               # Dynamic resources
│       └── docs/[topic].ts      # Documentation resource
├── app/                         # Next.js App Router
│   ├── page.tsx                 # Main page
│   └── components/
│       └── ChatInterface.tsx    # Chat UI component
└── README.md                    # This file
```

## Example Queries

Try these questions in the chat:

- "How does streaming work in this codebase?"
- "Search for agent implementations"
- "What files are in the src directory?"
- "Show me the current git status"
- "Read the streaming implementation file"

## Key Technologies

- **Veryfront AI** - Meta-framework with built-in AI
- **OpenAI GPT-4** - Language model
- **Streaming** - Real-time token-by-token responses
- **Tool Calling** - Function execution during generation
- **MCP Protocol** - Model Context Protocol for tool discovery
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Type-safe development

## Architecture Highlights

### Auto-Discovery

All tools, prompts, and resources are automatically discovered from the `ai/`
directory. No manual registration needed!

### Streaming with Tool Calling

The assistant streams responses in real-time while executing tools. Watch as it
searches code, reads files, and explains what it finds.

### Production Ready

- Rate limiting to prevent abuse
- Response caching for performance
- Cost tracking for API usage
- Input validation and output filtering

## Development

```bash
# Run with MCP server
deno run --allow-all ../../src/cli/main.ts dev --mcp

# The MCP server will be available at http://localhost:3001
```

## Next Steps

1. Connect real file system operations
2. Add more tools (e.g., run tests, format code)
3. Implement conversation memory
4. Add user authentication
5. Deploy to production

## Learn More

- [Veryfront Documentation](https://veryfront.com/docs)
- [MCP Protocol Spec](https://modelcontextprotocol.io)
- [OpenAI API Docs](https://platform.openai.com/docs)
