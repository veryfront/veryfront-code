# CLI Module

Command-line interface for Veryfront: development server, builds, deployment, and MCP server for coding agents.

## Quick Start

```bash
deno task dev              # Single-project dev server (port 3000)
deno task start            # Multi-project TUI dashboard (port 8080) + MCP
deno task start:headless   # Headless mode (no TUI, for coding agents)
deno task cli --help       # Show all commands
```

## Structure

```
cli/
├── main.ts             # Entry point
├── index.ts            # Public exports
│
├── index/              # Core: routing, arg parsing, handlers
├── commands/           # Command implementations (dev, build, deploy, etc.)
├── shared/             # Constants, config, arg utilities
│
├── app/                # TUI dashboard
├── auth/               # Login, token storage, OAuth
├── sync/               # Pull/push, remote project discovery
├── mcp/                # MCP server and tools for coding agents
│
├── ui/                 # Colors, ANSI, box drawing
├── utils/              # General utilities
├── help/               # Command definitions, help formatting
├── discovery/          # User project file discovery (tools, agents)
├── templates/          # Project and integration templates
└── test-utils/         # VCR testing utilities
```

## Commands

Run `veryfront <command> --help` for options:

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `dev`           | Development server with HMR and TUI |
| `build`         | Production build                    |
| `deploy`        | Deploy to Veryfront                 |
| `init`          | Create new project                  |
| `generate`      | Scaffold pages, APIs, components    |
| `doctor`        | Project diagnostics                 |
| `login`         | Authenticate                        |
| `pull` / `push` | Sync with remote                    |

## Testing

```bash
deno test src/cli/ --allow-all
```

## Related

- **STYLE_GUIDE.md** - CLI output conventions
- **mcp/skills/** - MCP skill definitions
- **observability/** - Error collection used by MCP tools
