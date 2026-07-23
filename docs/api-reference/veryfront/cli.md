---
title: "veryfront/cli"
description: "Veryfront CLI entry point."
order: 4
---

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
| `veryfront push` | Upload local source files to a Veryfront branch |
| `veryfront up` | Deploy your app with one command (login, create, push, deploy) |

### Project

| Command | Description |
|---------|-------------|
| `veryfront config` | Show effective project configuration |
| `veryfront demo` | Interactive guided tour of Veryfront CLI |
| `veryfront init` | Initialize a new Veryfront project |
| `veryfront install` | Install AI assistant integrations (Cursor, Claude Code, etc.) |
| `veryfront open` | Open project URLs in the browser |
| `veryfront start` | Start the production dashboard and proxy server |
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
| `veryfront eval` | Discover and run eval definitions |
| `veryfront issues` | Manage file-backed project issues |
| `veryfront mcp` | Start MCP server for coding agents |
| `veryfront schedule` | Run a source-defined schedule locally |
| `veryfront schedules` | List source-defined schedules |
| `veryfront skills` | List and inspect available agent skills |
| `veryfront task` | Run a task from the tasks/ directory |
| `veryfront webhook` | Run a source-defined webhook locally with a fixture payload |
| `veryfront webhooks` | List source-defined webhooks |
| `veryfront worker` | Start workflow run worker |
| `veryfront workflow` | Run a workflow from the workflows directory |

### Auth

| Command | Description |
|---------|-------------|
| `veryfront login` | Authenticate with Veryfront |
| `veryfront logout` | Clear stored authentication credentials |
| `veryfront whoami` | Show the current authenticated identity |
