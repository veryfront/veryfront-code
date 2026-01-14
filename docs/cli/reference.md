# Veryfront CLI Reference

Complete reference for all Veryfront CLI commands.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help for command |
| `--version, -v` | Show version |
| `--verbose` | Enable verbose output |
| `--quiet, -q` | Suppress non-essential output |
| `--color` | Force color output |
| `--no-color` | Disable color output |

## Commands

### init

Initialize a new Veryfront project.

```bash
veryfront init [project-name] [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-t, --template <name>` | Project template (ai, app, blog, docs, minimal) | ai |
| `--integrations <list>` | Service integrations (gmail,slack,github,calendar) | - |
| `-c, --config <file>` | JSON config file for programmatic scaffolding | - |
| `--skip-install` | Skip automatic dependency installation | false |
| `--skip-env-prompt` | Skip environment variable prompts | false |

**Examples:**
```bash
veryfront init                                    # Interactive wizard
veryfront init my-app                             # Named project
veryfront init my-agent --template ai             # AI template
veryfront init my-agent --integrations gmail,slack # With integrations
veryfront init --config project.json              # From config file
```

### dev

Start development server with hot module replacement.

```bash
veryfront dev [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Port to run on | 3000 |
| `--no-hmr` | Disable hot module replacement | false |
| `--open` | Open browser automatically | false |

**Examples:**
```bash
veryfront dev
veryfront dev --port 8080
veryfront dev --open
veryfront dev --no-hmr
```

### build

Build your application for production.

```bash
veryfront build [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Output directory | .veryfront/output |
| `--no-compress` | Disable compression | false |
| `--no-split` | Disable code splitting | false |
| `--no-ssg` | Disable static generation | false |
| `--include <paths>` | Include specific paths in SSG | - |
| `--exclude <paths>` | Exclude paths from SSG | - |
| `--dry-run` | Preview what will be built | false |
| `--preset <name>` | Select build preset (e.g., embedded) | - |

**Examples:**
```bash
veryfront build
veryfront build --output dist
veryfront build --no-ssg
veryfront build --preset embedded
veryfront build --include /docs --exclude /api
veryfront build --dry-run
```

### serve / preview

Start production server.

```bash
veryfront serve [options]
veryfront preview [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Port to run on | 3000 |
| `--hostname <host>` | Hostname to bind to | 0.0.0.0 |

**Examples:**
```bash
veryfront serve
veryfront serve --port 8080
VERYFRONT_USE_REDIS_CACHE=1 veryfront serve
```

### pull

Download project files from Veryfront remote.

```bash
veryfront pull [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--projects <slugs>` | Comma-separated list of project slugs | - |
| `-d, --dir <path>` | Target directory | . |
| `-b, --branch <name>` | Branch to pull from | main |
| `--env <name>` | Environment to pull from (e.g., production, staging) | - |
| `--release <version>` | Release version to pull from (e.g., v1.2.0) | - |
| `-f, --force` | Force overwrite without confirmation | false |
| `--dry-run` | Show what would be written | false |

**Priority:** `--env` > `--release` > `--branch` > main

**Examples:**
```bash
veryfront pull
veryfront pull --dir ./my-project
veryfront pull --branch feature-header
veryfront pull --env production
veryfront pull --release v1.2.0
veryfront pull --projects project-a,project-b,project-c
veryfront pull --projects my-app --dir ./apps
veryfront pull --dry-run
veryfront pull --force
```

### push

Create a branch and upload local files to Veryfront.

```bash
veryfront push [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <path>` | Source directory | . |
| `-b, --branch <name>` | Branch name (use 'main' for direct push) | cli/push-\<timestamp\> |
| `-f, --force` | Push without confirmation | false |
| `--dry-run` | Show what would be uploaded | false |

**Examples:**
```bash
veryfront push
veryfront push --dir ./my-project
veryfront push --branch feature-header
veryfront push --branch main            # Push directly to main
veryfront push --dry-run
```

### merge

Merge a branch into main (or another branch).

```bash
veryfront merge <branch> [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--into <branch>` | Target branch to merge into | main |
| `-f, --force` | Merge without confirmation | false |
| `--dry-run` | Preview merge without executing | false |

**Examples:**
```bash
veryfront merge feature-login
veryfront merge hotfix --into staging
veryfront merge feature-header --dry-run
```

### deploy

Create a release and deploy to an environment.

```bash
veryfront deploy [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-b, --branch <name>` | Branch to release from | main |
| `--env <name>` | Environment to deploy to | production |
| `--release-name <name>` | Custom release name | auto-generated |
| `-f, --force` | Deploy without confirmation | false |
| `--dry-run` | Preview without executing | false |

**Examples:**
```bash
veryfront deploy
veryfront deploy --env staging
veryfront deploy --branch feature-x --env preview
veryfront deploy --release-name v1.2.0
veryfront deploy --dry-run
```

### doctor

Check system requirements and project health.

```bash
veryfront doctor [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-s, --strict` | Treat warnings as errors | false |

**Examples:**
```bash
veryfront doctor
veryfront doctor --strict
```

### clean

Clean build artifacts and caches.

```bash
veryfront clean [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `--cache` | Clean cache only | false |
| `--build` | Clean build output only | false |
| `--all` | Clean everything (node_modules, .deno, .veryfront) | false |
| `-f, --force` | Skip confirmation prompts | false |

**Examples:**
```bash
veryfront clean
veryfront clean --cache
veryfront clean --all
veryfront clean --all --force
```

### routes

List all discovered routes in your application.

```bash
veryfront routes [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-j, --json` | Output as JSON | false |

**Examples:**
```bash
veryfront routes
veryfront routes --json
```

### lock

Manage remote import lockfile for reproducible builds.

```bash
veryfront lock [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-l, --list` | List all locked imports | false |
| `-u, --update` | Update all locked imports | false |
| `--verify` | Verify integrity of locked imports | false |
| `--clear` | Clear the lockfile | false |
| `-f, --force` | Skip confirmation prompts | false |

**Examples:**
```bash
veryfront lock               # List locked imports
veryfront lock --list
veryfront lock --verify      # Check integrity
veryfront lock --update      # Refresh all entries
veryfront lock --clear       # Remove lockfile
```

### analyze-chunks

Analyze bundle chunks and sizes.

```bash
veryfront analyze-chunks [options]
```

**Options:**
| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Output analysis to file | - |

**Examples:**
```bash
veryfront analyze-chunks
veryfront analyze-chunks --output bundle-analysis.json
```

### generate

Generate code scaffolds.

```bash
veryfront generate <type> [name]
veryfront g <type> [name]
```

**Types:**
- `page` - Generate a new page
- `layout` - Generate a new layout
- `provider` - Generate a context provider
- `api` - Generate an API endpoint
- `integration` - Generate a service integration

**Examples:**
```bash
veryfront generate page about
veryfront generate layout admin
veryfront generate api users/[id]
veryfront generate provider auth
veryfront generate integration              # Interactive wizard
veryfront generate integration twilio       # With name preset
```

## Configuration Files

### .veryfrontrc

Project configuration for remote synchronization:

```json
{
  "projectSlug": "my-project",
  "apiUrl": "https://api.veryfront.com",
  "apiToken": "vf_...",
  "projects": ["project-a", "project-b"]
}
```

### veryfront.config.ts

Framework configuration:

```typescript
export default {
  fs: {
    type: "veryfront-api",
    veryfront: {
      baseUrl: "https://api.veryfront.com",
      proxyMode: false,
      cache: { enabled: true, ttl: 60000 }
    }
  },
  dev: {
    port: 3000,
    hmr: true
  },
  build: {
    compress: true,
    split: true,
    ssg: true
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERYFRONT_API_TOKEN` | API authentication token |
| `VERYFRONT_PROJECT_SLUG` | Default project slug |
| `PROXY_MODE` | Enable proxy mode (0 or 1) |
| `PRODUCTION_MODE` | Use production releases (0 or 1) |
| `NO_COLOR` | Disable colored output |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |

## Notes

- All commands support `--help` for detailed usage
- Use `--dry-run` to preview destructive operations
- API token is required for remote operations (pull, push, merge, deploy)
- Project slug is inferred from package.json name or directory if not specified
