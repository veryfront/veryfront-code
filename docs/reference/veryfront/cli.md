---
title: "veryfront/cli"
description: "Veryfront CLI entry point."
order: 27
---

# veryfront/cli

Veryfront CLI entry point.

## Examples

```sh
npx veryfront dev
```

## Commands

The CLI groups commands by category. Each command supports `--help` for its full usage, options, and examples (`veryfront <command> --help`). For machine-readable output use `veryfront schema --json`.

### Development

| Command | Description |
|---------|-------------|
| `veryfront analyze-chunks` | Analyze bundle chunks and sizes |
| `veryfront build` | Build your application for production |
| `veryfront clean` | Clean build artifacts and caches |
| `veryfront completions` | Generate shell completion scripts |
| `veryfront dev` | Start development server with hot module replacement |
| `veryfront doctor` | Check system requirements and project health |
| `veryfront extension` | Scaffold and validate veryfront extensions |
| `veryfront generate` | Generate code scaffolds |
| `veryfront lint` | Run linter with optional structured JSON output |
| `veryfront routes` | List all discovered routes in your application |
| `veryfront schema` | Show CLI command schema for agent discovery |
| `veryfront serve` | Start production server |
| `veryfront styles` | Build project CSS artifacts |
| `veryfront test` | Run tests with optional structured JSON output |

### Deploy & Sync

| Command | Description |
|---------|-------------|
| `veryfront deploy` | Create a release and deploy to an environment |
| `veryfront lock` | Manage remote import lockfile for reproducible builds |
| `veryfront merge` | Merge a branch into main (or another branch) |
| `veryfront pull` | Download project files from Veryfront remote |
| `veryfront push` | Create a branch and upload local files to Veryfront |
| `veryfront up` | Deploy your app with one command (login, create, push, deploy) |

### Project

| Command | Description |
|---------|-------------|
| `veryfront config` | Show effective project configuration |
| `veryfront demo` | Interactive guided tour of Veryfront CLI |
| `veryfront init` | Initialize a new Veryfront project |
| `veryfront install` | Install AI assistant integrations (Cursor, Claude Code, etc.) |
| `veryfront open` | Open project URLs in the browser |
| `veryfront start` | Start development dashboard with proxy and MCP integration |
| `veryfront studio` | Open Veryfront Studio in browser |
| `veryfront uninstall` | Remove AI assistant integrations |

### Files & Data

| Command | Description |
|---------|-------------|
| `veryfront files` | List, read, write, and delete project files |
| `veryfront knowledge` | Ingest documents into the project knowledge base |
| `veryfront uploads` | List, pull, upload, and delete project uploads |

### AI & Automation

| Command | Description |
|---------|-------------|
| `veryfront issues` | File-based issue tracking (SDLC conventions) |
| `veryfront mcp` | Start MCP server for coding agents |
| `veryfront skills` | List and inspect available agent skills |
| `veryfront task` | Run a task from the tasks/ directory |
| `veryfront worker` | Start workflow job worker |
| `veryfront workflow` | Run a workflow from the workflows directory |

### Auth

| Command | Description |
|---------|-------------|
| `veryfront login` | Authenticate with Veryfront |
| `veryfront logout` | Clear stored authentication credentials |
| `veryfront whoami` | Show current authenticated user |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `ensureEnvLoaded` | Load `.env` files and initialize environment config if not already done. | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L39) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `args` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L62) |
| `exitProcess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L69) |
| `getArgs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L33) |
| `hasEnvLoaded` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L34) |
| `loadEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L34) |
| `markEnvLoaded` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L34) |
| `parseCliArgs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L63) |
| `routeCommand` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L64) |
| `supportsEnvFiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/main.ts#L34) |

## Related

User guides:

- [cli-knowledge-ingestion](../../guides/cli-knowledge-ingestion.md): CLI knowledge ingestion
