# Veryfront CLI Workflow Guide

This guide explains how to use the Veryfront CLI to manage your project files with remote synchronization, branching, merging, and deployment.

## Overview

The Veryfront CLI provides a git-like workflow for managing your AI applications:

```
pull → edit locally → push → merge → deploy
```

## Prerequisites

1. **API Token**: Set your token in the environment:
   ```bash
   export VERYFRONT_API_TOKEN=vf_your_token_here
   ```

2. **Project Configuration** (optional): Create `.veryfrontrc` in your project directory:
   ```json
   {
     "projectSlug": "my-project",
     "apiUrl": "https://api.veryfront.com"
   }
   ```

## Commands

### 1. Pull - Download Project Files

Download files from Veryfront to your local machine.

```bash
# Pull from main branch (default)
veryfront pull

# Pull from a specific branch
veryfront pull --branch=feature-header

# Pull from an environment (e.g., production)
veryfront pull --env=production

# Pull from a specific release
veryfront pull --release=v1.2.0

# Pull to a specific directory
veryfront pull --dir=./my-project

# Pull multiple projects
veryfront pull --projects=app-a,app-b,app-c

# Preview what would be downloaded
veryfront pull --dry-run

# Force overwrite without confirmation
veryfront pull --force
```

**Options:**
| Flag | Description |
|------|-------------|
| `-b, --branch <name>` | Branch to pull from (default: main) |
| `--env <name>` | Environment to pull from (e.g., production, staging) |
| `--release <version>` | Release version to pull from (e.g., v1.2.0) |
| `-d, --dir <path>` | Target directory (default: current directory) |
| `--projects <slugs>` | Comma-separated list of project slugs |
| `-f, --force` | Force overwrite without confirmation |
| `--dry-run` | Show what would be written without writing |

**Note:** Priority order: `--env` > `--release` > `--branch` > main

### 2. Push - Upload Local Changes

Push your local changes to Veryfront. By default, creates a new branch for your changes.

```bash
# Push to auto-generated branch (e.g., cli/push-1704067200)
veryfront push

# Push to a named branch
veryfront push --branch=feature-login

# Push directly to main (no branch creation)
veryfront push --branch=main

# Preview what would be uploaded
veryfront push --dry-run

# Push from a specific directory
veryfront push --dir=./my-project
```

**Options:**
| Flag | Description |
|------|-------------|
| `-b, --branch <name>` | Branch name (auto-generated if omitted, use "main" for direct push) |
| `-d, --dir <path>` | Source directory (default: current directory) |
| `-f, --force` | Push without confirmation |
| `--dry-run` | Show what would be uploaded without uploading |

### 3. Merge - Merge Branches

Merge a branch into main (or another target branch).

```bash
# Merge feature-login into main
veryfront merge feature-login

# Merge into a different target branch
veryfront merge hotfix --into staging

# Preview merge without executing
veryfront merge feature-header --dry-run

# Skip confirmation
veryfront merge feature-login --force
```

**Options:**
| Flag | Description |
|------|-------------|
| `--into <branch>` | Target branch (default: main) |
| `-f, --force` | Skip confirmation |
| `--dry-run` | Preview merge without executing |

### 4. Deploy - Release to Production

Create a release and deploy to an environment.

```bash
# Deploy main branch to production (defaults)
veryfront deploy

# Deploy to staging environment
veryfront deploy --env staging

# Deploy from a specific branch
veryfront deploy --branch feature-x --env preview

# Custom release name
veryfront deploy --release-name v1.2.0

# Preview deployment
veryfront deploy --dry-run
```

**Options:**
| Flag | Description |
|------|-------------|
| `-b, --branch <name>` | Branch to release from (default: main) |
| `--env <name>` | Environment to deploy to (default: production) |
| `--release-name <name>` | Custom release name (auto-generated if omitted) |
| `-f, --force` | Deploy without confirmation |
| `--dry-run` | Preview without executing |

## Complete Workflow Example

Here's a typical development workflow:

```bash
# 1. Pull the latest files from main
veryfront pull

# 2. Make your changes locally
# ... edit files in your editor ...

# 3. Push changes to a new branch
veryfront push --branch=feature-new-header

# 4. Preview the merge
veryfront merge feature-new-header --dry-run

# 5. Merge your branch into main
veryfront merge feature-new-header

# 6. Deploy to staging first
veryfront deploy --env staging

# 7. Verify staging, then deploy to production
veryfront deploy
```

## CI/CD Integration

You can use these commands in CI/CD pipelines:

```yaml
# GitHub Actions example
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Deno
        uses: denoland/setup-deno@v1

      - name: Deploy to production
        env:
          VERYFRONT_API_TOKEN: ${{ secrets.VERYFRONT_API_TOKEN }}
        run: |
          veryfront deploy --force
```

## Error Handling

The CLI provides clear error messages with usage hints:

```bash
# Missing required argument
$ veryfront merge
Error: Invalid merge arguments:
  - branch: Branch name is required
Usage: veryfront merge <branch> [options]

# Environment not found
$ veryfront deploy --env nonexistent
Error: Environment "nonexistent" not found
```

## Tips

1. **Use `--dry-run` first**: Always preview destructive operations before executing.

2. **Branch naming convention**: Use descriptive branch names like `feature/`, `fix/`, or `hotfix/` prefixes.

3. **Environment variables**: Store your API token in `.env` or CI/CD secrets, not in code.

4. **Multi-project monorepos**: Use `--projects` flag to pull multiple projects into subdirectories.
