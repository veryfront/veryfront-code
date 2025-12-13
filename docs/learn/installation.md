---
title: Installation
description: Install Veryfront on Deno, Node.js, Bun, or Cloudflare Workers
category: learn
level: beginner
keywords:
  - installation
  - setup
  - deno
  - node
  - bun
reading_time: 10 min
prev_page: /learn/introduction.md
next_page: /learn/quickstart.md
---

# Installation

Install Veryfront on your preferred runtime. This guide focuses on **Deno** (recommended), with links to guides for other runtimes.

## Quick Install (Deno)

**Install Deno:**
```bash
# macOS / Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex

# Homebrew
brew install deno
```

**Create Project:**
```bash
mkdir my-app && cd my-app
deno init
deno add @veryfront/core react react-dom
```

**Configure `deno.json`:**
```json
{
  "tasks": {
    "dev": "deno run --allow-all --watch src/main.ts",
    "build": "veryfront build",
    "start": "deno run --allow-net --allow-read --allow-env main.ts"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0",
    "veryfront/": "jsr:@veryfront/core@^0.1.0/",
    "react": "npm:react@^18.3.0",
    "react-dom": "npm:react-dom@^18.3.0"
  }
}
```

**Create First Page:**
```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Hello Veryfront!</h1>
      <p>Running on Deno</p>
    </div>
  );
}
```

**Create Config:**
```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'deno',
  projectName: 'my-app',
});
```

**Start Dev Server:**
```bash
deno task dev
```

Visit **http://localhost:3000**

## Why Deno?

- **Fast Setup** - No node_modules, no build step
- **Secure by Default** - Explicit permissions
- **Modern Package Management** - JSR + npm
- **TypeScript Native** - No compilation needed
- **Easy Deployment** - Deploy to Deno Deploy

## Other Runtimes

### Node.js

**Prerequisites:** Node.js 18.0+, npm 8.0+

```bash
mkdir my-app && cd my-app
npm init -y
npm install veryfront react react-dom
npm install -D typescript @types/react @types/react-dom
```

**Full guide:** [Node.js Installation](/guides/deployment/node.md)

### Bun

**Prerequisites:** Bun 1.0+

```bash
curl -fsSL https://bun.sh/install | bash
mkdir my-app && cd my-app
bun init
bun add veryfront react react-dom
```

**Full guide:** [Bun Installation](/guides/deployment/bun.md)

### Cloudflare Workers

**Prerequisites:** Node.js 18.0+, Cloudflare account

```bash
npm install -g wrangler
wrangler login
npm create cloudflare@latest my-app -- --framework=veryfront
```

**Full guide:** [Cloudflare Installation](/guides/deployment/cloudflare.md)

## IDE Setup

### Visual Studio Code (Recommended)

**Install Extensions:**
1. Deno (denoland.vscode-deno)
2. ESLint (dbaeumer.vscode-eslint)
3. Prettier (esbenp.prettier-vscode)

**Configure Workspace (`.vscode/settings.json`):**
```json
{
  "deno.enable": true,
  "deno.lint": true,
  "deno.unstable": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

### Other IDEs

- **WebStorm:** Deno plugin available
- **Zed:** Built-in Deno support
- **Neovim:** Use denols LSP

## Verify Installation

Test that everything works:

```bash
# 1. Development server starts
deno task dev

# 2. Visit http://localhost:3000
# You should see "Hello Veryfront!"

# 3. Make a change to app/page.tsx
# Page should hot-reload automatically

# 4. Build for production
deno task build

# 5. Start production server
deno task start
```

## Troubleshooting

### "Command not found: deno"

Restart terminal or add to PATH:
```bash
export PATH="$HOME/.deno/bin:$PATH"
# Add to ~/.zshrc or ~/.bashrc to make permanent
```

### "Module not found"

Check `deno.json` imports:
```json
{
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0"
  }
}
```

### "Permission denied"

Add required permissions:
```bash
deno run --allow-net --allow-read --allow-env --allow-write main.ts
# Or use --allow-all for development
deno run --allow-all main.ts
```

### Port already in use

Kill process or use different port:
```bash
lsof -ti:3000 | xargs kill -9
# Or
deno task dev --port 3001
```

## Runtime Comparison

| Feature | Deno | Node.js | Bun | Cloudflare |
|---------|------|---------|-----|------------|
| **Setup Time** | 2 min | 5 min | 2 min | 10 min |
| **TypeScript** | Native | Via tsc | Native | Via tsc |
| **Build Step** | Optional | Required | Optional | Required |
| **Cold Start** | ~10ms | ~200ms | ~50ms | ~0ms |

## System Requirements

**Minimum:**
- RAM: 2 GB
- Disk: 100 MB (plus dependencies)
- OS: macOS, Linux, Windows (WSL2 for Bun)
- Runtime: Deno 1.40+, Node.js 18+, or Bun 1.0+

**Recommended:**
- RAM: 4 GB+
- Disk: 1 GB+
- OS: macOS or Linux
- Runtime: Deno 1.40+ or Node.js 20+

## Next Steps

You're all set! Continue with:

1. **[Quick Start](/learn/quickstart.md)** - Build your first app (30 minutes)
2. **[Routing Guide](/guides/routing/README.md)** - Learn file-based routing
3. **[Deployment](/guides/deployment/deno.md)** - Go to production

## Related Guides

### Getting Started
- [What is Veryfront?](/learn/introduction.md) - Framework overview and features
- [Quick Start Tutorial](/learn/quickstart.md) - Build your first application

### Platform-Specific Guides
- [Deno Deployment](/guides/deployment/deno.md) - Deploy to Deno Deploy (recommended)
- [Node.js Deployment](/guides/deployment/node.md) - Deploy with Node.js
- [Bun Deployment](/guides/deployment/bun.md) - Deploy with Bun
- [Cloudflare Workers](/guides/deployment/cloudflare.md) - Deploy to Cloudflare

### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Complete configuration options
- [CLI Reference](/reference/cli/README.md) - Command-line tools
- [File Conventions](/reference/file-conventions/README.md) - Project structure

### Troubleshooting
- [Debugging Guide](/guides/troubleshooting/debugging.md) - Common issues and solutions
- [Troubleshooting](/guides/troubleshooting/README.md) - Troubleshooting overview

---

**Need help?** Check the [troubleshooting guide](/guides/troubleshooting/README.md) or [ask for help](https://github.com/veryfront/veryfront/discussions).
