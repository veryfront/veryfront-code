# Veryfront AI - Auto-Discovery Example

This example demonstrates the convention-driven auto-discovery system:

- Automatic discovery of tools from `ai/tools/`
- Automatic discovery of agents from `ai/agents/`
- Automatic discovery of resources from `ai/resources/`
- Automatic discovery of prompts from `ai/prompts/`
- Creating an MCP server with discovered components

## Setup

1. No API key required for basic discovery (only needed for agent execution)

2. Run the example:

```bash
deno run --allow-read --allow-net --allow-env example.ts
```

## What It Does

1. Scans the `ai/` directory for AI components
2. Automatically registers discovered tools, agents, resources, and prompts
3. Shows discovery results with counts and details
4. Creates an MCP server that exposes all discovered components
5. Demonstrates the registry stats and component details

## Directory Structure

```
ai/
├── tools/
│   ├── greet.ts           # Simple greeting tool
│   └── search-web.ts      # Web search tool
├── prompts/
│   └── support.ts         # Customer support prompt template
└── resources/
    └── users/             # User data resource
```

## Files

- `example.ts` - Main example code demonstrating auto-discovery
- `ai/tools/greet.ts` - Example tool (auto-discovered)
- `ai/tools/search-web.ts` - Example search tool
- `ai/prompts/support.ts` - Example prompt template

## Key Features

- **Zero Configuration**: Just create files in the right location
- **Convention-based**: File names become IDs (kebab-case)
- **MCP Integration**: Automatically exposed via MCP server
- **Type-safe**: Full TypeScript support
- **Hot Reload Ready**: Discover on startup or dynamically
