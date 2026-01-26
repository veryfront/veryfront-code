# Veryfront

The simplest way to build AI-powered apps.

```bash
npx veryfront
```

```
  ○ ○ ○ ○ ○ ○ ○
  ○ ● ● ● ○ ○ ○   Veryfront is now running
  ○ ● ● ● ○ ○ ○
  ○ ● ● ○ ● ● ○   Url  http://veryfront.me:3000
  ○ ○ ○ ● ● ● ○   Mcp  http://veryfront.me:3002/mcp
  ○ ○ ○ ● ● ● ○
  ○ ○ ○ ○ ○ ○ ○

  ✓ Server ready
  ✓ MCP ready
```

One command. Zero config. Just build.

## Project Structure

```
my-app/
├── app/                     # App Router (pages & APIs)
│   ├── chat/page.tsx
│   └── api/chat/route.ts
├── agents/                  # AI agents
├── tools/                   # MCP tools
├── workflows/               # Durable workflows
├── prompts/                 # Prompt templates
└── resources/               # MCP resources
```

All directories are auto-discovered.

## Documentation

- [Getting Started](https://veryfront.com/docs/framework)
- [Agents](https://veryfront.com/docs/framework/agents)
- [Tools](https://veryfront.com/docs/framework/tools)
- [Workflows](https://veryfront.com/docs/framework/workflows)
- [MCP Server](https://veryfront.com/docs/framework/mcp)

## Community

- [Discord](https://discord.gg/veryfront)
- [X](https://x.com/veryfrontdev)
- [GitHub Discussions](https://github.com/veryfront/veryfront/discussions)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
