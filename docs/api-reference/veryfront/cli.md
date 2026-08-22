---
title: "veryfront/cli"
description: "Veryfront CLI entry point."
order: 4
---

## Examples

```sh
npx veryfront@latest dev
```

## Commands

The CLI groups commands by category. Each command supports `--help` for its full usage, options, and examples (`veryfront <command> --help`). For machine-readable output use `veryfront schema --json`.

### Development

| Command                    | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `veryfront analyze-chunks` | Analyze bundle chunks and sizes                      |
| `veryfront build`          | Build your application for production                |
| `veryfront clean`          | Clean build artifacts and caches                     |
| `veryfront completions`    | Generate shell completion scripts                    |
| `veryfront dev`            | Start development server with hot module replacement |
| `veryfront doctor`         | Check system requirements and project health         |
| `veryfront extension`      | Scaffold and validate veryfront extensions           |
| `veryfront generate`       | Generate code scaffolds                              |
| `veryfront lint`           | Run linter with optional structured JSON output      |
| `veryfront routes`         | List all discovered routes in your application       |
| `veryfront schema`         | Show CLI command schema for agent discovery          |
| `veryfront serve`          | Run the production HTTP server (headless)            |
| `veryfront styles`         | Build project CSS artifacts                          |
| `veryfront test`           | Run tests with optional structured JSON output       |

### Deploy & Sync

| Command            | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `veryfront deploy` | Promote a branch to an environment                    |
| `veryfront env`    | Mint a short-lived token for a protected environment  |
| `veryfront lock`   | Manage remote import lockfile for reproducible builds |
| `veryfront merge`  | Merge a branch into main (or another branch)          |
| `veryfront pull`   | Download project files from Veryfront remote          |
| `veryfront push`   | Push source to a cloud preview                        |
| `veryfront up`     | Create and publish the initial cloud preview          |

### Project

| Command               | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `veryfront config`    | Show effective project configuration                          |
| `veryfront demo`      | Interactive guided tour of Veryfront CLI                      |
| `veryfront init`      | Initialize a new Veryfront project                            |
| `veryfront install`   | Install AI assistant integrations (Cursor, Claude Code, etc.) |
| `veryfront open`      | Open the Cloud dashboard, or the deployed site with --site    |
| `veryfront project`   | Delete a cloud project and everything it owns                 |
| `veryfront start`     | Run the production dashboard with proxy and TUI               |
| `veryfront studio`    | Open Veryfront Studio in browser                              |
| `veryfront uninstall` | Remove AI assistant integrations                              |

### Files & Data

| Command               | Description                                      |
| --------------------- | ------------------------------------------------ |
| `veryfront files`     | List, read, write, and delete project files      |
| `veryfront knowledge` | Ingest documents into the project knowledge base |
| `veryfront uploads`   | List, pull, upload, and delete project uploads   |

### AI & Automation

| Command               | Description                                       |
| --------------------- | ------------------------------------------------- |
| `veryfront eval`      | List, run, and export discovered eval definitions |
| `veryfront issues`    | File-based issue tracking (SDLC conventions)      |
| `veryfront mcp`       | Start MCP server for coding agents                |
| `veryfront schedule`  | List or run source-defined schedules              |
| `veryfront schedules` | List source-defined schedules                     |
| `veryfront skills`    | List and inspect available agent skills           |
| `veryfront task`      | Run a task from the tasks/ directory              |
| `veryfront webhook`   | List or run source-defined webhooks               |
| `veryfront webhooks`  | List source-defined webhooks                      |
| `veryfront worker`    | Start workflow run worker                         |
| `veryfront workflow`  | Run a workflow from the workflows directory       |

### Auth

| Command            | Description                             |
| ------------------ | --------------------------------------- |
| `veryfront login`  | Authenticate with Veryfront             |
| `veryfront logout` | Clear stored authentication credentials |
| `veryfront whoami` | Show the current authenticated identity |
