---
title: "Installation Guide"
category: "getting-started"
level: "beginner"
keywords: ["installation", "setup", "deno", "node", "bun", "cloudflare", "quickstart"]
ai_summary: "Complete installation instructions for Veryfront across all supported runtimes: Deno, Node.js, Bun, and Cloudflare Workers"
related: ["quick-start", "introduction", "guides/deployment/deno"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Installation Guide

Install Veryfront on your preferred runtime. Veryfront supports four JavaScript runtimes, each with unique strengths.

## Choose Your Runtime

| Runtime | Best For | Installation Time |
|---------|----------|------------------|
| **Deno** (Recommended) | New projects, edge deployment, TypeScript-first | 2 minutes |
| **Node.js** | Existing Node apps, npm ecosystem | 3 minutes |
| **Bun** | Maximum performance, drop-in Node replacement | 2 minutes |
| **Cloudflare Workers** | Global edge, serverless | 5 minutes |

**New to Veryfront?** Start with [Deno](#deno-installation-recommended) - it's the fastest to set up and works perfectly with Veryfront.

---

## Deno Installation (Recommended)

### Why Deno?

- ⚡ **Fast Setup** - Zero configuration required
- 🔒 **Secure by Default** - Explicit permissions system
- 📦 **No node_modules** - Direct imports from URLs or JSR
- 🎯 **TypeScript Native** - No build step needed
- 🚀 **Deploy Instantly** - One-click deploy to Deno Deploy

### 1. Install Deno

**macOS / Linux:**
```bash
curl -fsSL https://deno.land/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://deno.land/install.ps1 | iex
```

**Homebrew (macOS):**
```bash
brew install deno
```

**Verify installation:**
```bash
deno --version
# deno 1.40.0 (or later)
```

### 2. Create a New Veryfront Project

```bash
# Create project
mkdir my-veryfront-app
cd my-veryfront-app

# Initialize Deno project
deno init

# Install Veryfront
deno add @veryfront/core
```

### 3. Configure `deno.json`

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

### 4. Create Your First Page

```typescript
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

### 5. Create Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'deno',
  projectName: 'my-app',
});
```

### 6. Start Development Server

```bash
deno task dev
```

Visit **http://localhost:3000** 🎉

### Next Steps (Deno)

- [Quick Start Guide](../quick-start.md) - Build your first app in 5 minutes
- [Deploy to Deno Deploy](../guides/deployment/deno.md) - Go live in production
- [Routing Guide](../routing/README.md) - Add more pages

---

## Node.js Installation

### Why Node.js?

- 🏢 **Enterprise Ready** - Battle-tested in production
- 📦 **npm Ecosystem** - Access to millions of packages
- 🔧 **Familiar Tooling** - Works with your existing workflow
- 🌍 **Universal** - Deploy anywhere Node.js runs

### Prerequisites

- **Node.js 18.0+** (20.0+ recommended)
- **npm 8.0+** or **yarn 1.22+**

### 1. Install Node.js

**Download from [nodejs.org](https://nodejs.org)**

Or use a version manager:

**nvm (macOS/Linux):**
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node.js
nvm install 20
nvm use 20
```

**nvm-windows:**
Download from [github.com/coreybutler/nvm-windows](https://github.com/coreybutler/nvm-windows/releases)

**Verify installation:**
```bash
node --version  # v20.0.0 or later
npm --version   # 8.0.0 or later
```

### 2. Create a New Project

```bash
# Create project directory
mkdir my-veryfront-app
cd my-veryfront-app

# Initialize npm project
npm init -y
```

### 3. Install Dependencies

```bash
# Install Veryfront
npm install veryfront react react-dom

# Install dev dependencies
npm install -D typescript @types/react @types/react-dom
```

### 4. Configure `package.json`

```json
{
  "name": "my-veryfront-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "start": "veryfront start"
  },
  "dependencies": {
    "veryfront": "^0.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

### 5. Configure TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["veryfront/types"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".veryfront"]
}
```

### 6. Create Your First Page

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Hello Veryfront!</h1>
      <p>Running on Node.js</p>
    </div>
  );
}
```

### 7. Create Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'node',
  projectName: 'my-app',
});
```

### 8. Start Development Server

```bash
npm run dev
```

Visit **http://localhost:3000** 🎉

### Next Steps (Node.js)

- [Deploy to Vercel](../guides/deployment/node.md) - Deploy with zero config
- [Routing Guide](../routing/README.md) - Add more pages
- [API Routes](../routing/api-routes.md) - Create backend APIs

---

## Bun Installation

### Why Bun?

- ⚡ **Blazing Fast** - 3x faster than Node.js
- 🔋 **All-in-One** - Runtime, bundler, test runner, package manager
- 🔌 **Drop-in Replacement** - Compatible with Node.js and npm
- 📦 **Fast Installs** - Up to 25x faster than npm

### 1. Install Bun

**macOS / Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows:**
Bun does not officially support Windows yet. Use WSL2 (Windows Subsystem for Linux).

**Verify installation:**
```bash
bun --version
# 1.0.0 or later
```

### 2. Create a New Project

```bash
# Create project
mkdir my-veryfront-app
cd my-veryfront-app

# Initialize bun project
bun init
```

### 3. Install Dependencies

```bash
# Install Veryfront
bun add veryfront react react-dom

# Install dev dependencies
bun add -d typescript @types/react @types/react-dom
```

### 4. Configure `package.json`

```json
{
  "name": "my-veryfront-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run veryfront dev",
    "build": "bun run veryfront build",
    "start": "bun run veryfront start"
  },
  "dependencies": {
    "veryfront": "^0.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

### 5. Configure TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types", "veryfront/types"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".veryfront"]
}
```

### 6. Create Your First Page

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Hello Veryfront!</h1>
      <p>Running on Bun 🥟</p>
    </div>
  );
}
```

### 7. Create Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'bun',
  projectName: 'my-app',
});
```

### 8. Start Development Server

```bash
bun run dev
```

Visit **http://localhost:3000** 🎉

### Next Steps (Bun)

- [Deploy with Bun](../guides/deployment/bun.md) - Production deployment
- [Performance Guide](../guides/performance.md) - Optimize for speed
- [Routing Guide](../routing/README.md) - Add more pages

---

## Cloudflare Workers Installation

### Why Cloudflare Workers?

- 🌍 **Global Edge** - Deploy to 300+ cities worldwide
- ⚡ **Zero Cold Starts** - Instant execution
- 💰 **Generous Free Tier** - 100k requests/day free
- 🔒 **Secure** - Sandboxed execution environment

### Prerequisites

- Cloudflare account (free at [cloudflare.com](https://www.cloudflare.com))
- Node.js 18.0+ (for Wrangler CLI)

### 1. Install Wrangler CLI

```bash
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### 2. Create a New Project

```bash
# Create project from template
npm create cloudflare@latest my-veryfront-app -- --framework=veryfront

# Or manually
mkdir my-veryfront-app
cd my-veryfront-app
npm init -y
```

### 3. Install Dependencies

```bash
npm install veryfront react react-dom
npm install -D wrangler typescript @types/react @types/react-dom
```

### 4. Configure `wrangler.toml`

```toml
name = "my-veryfront-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"

[site]
bucket = ".veryfront/public"

[[route]]
pattern = "*"
zone_name = "example.com"  # Your domain
```

### 5. Configure `package.json`

```json
{
  "name": "my-veryfront-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "veryfront build --platform=cloudflare",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "veryfront": "^0.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "typescript": "^5.3.0"
  }
}
```

### 6. Create Your First Page

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Hello Veryfront!</h1>
      <p>Running on Cloudflare Workers</p>
    </div>
  );
}
```

### 7. Create Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'cloudflare',
  projectName: 'my-app',
  adapter: {
    type: 'cloudflare-workers',
  },
});
```

### 8. Start Development Server

```bash
npm run dev
```

Visit **http://localhost:8787** 🎉

### 9. Deploy to Production

```bash
npm run build
npm run deploy
```

Your app is now live on Cloudflare's global network!

### Next Steps (Cloudflare)

- [Cloudflare Workers Guide](../guides/deployment/cloudflare.md) - Full deployment docs
- [Edge Computing Patterns](../guides/edge.md) - Optimize for the edge
- [KV Storage](../guides/cloudflare-kv.md) - Add data persistence

---

## Project Templates

Start faster with pre-built templates:

### Minimal App Router
```bash
# Deno
deno run -A https://veryfront.com/init --template=minimal-app

# Node.js
npx create-veryfront@latest --template=minimal-app

# Bun
bunx create-veryfront@latest --template=minimal-app
```

### Blog Template
```bash
deno run -A https://veryfront.com/init --template=blog
```

### SaaS Starter
```bash
deno run -A https://veryfront.com/init --template=saas
```

### Full-Stack with AI
```bash
deno run -A https://veryfront.com/init --template=ai-app
```

---

## IDE Setup

### Visual Studio Code (Recommended)

**Install extensions:**
1. **Deno** (denoland.vscode-deno) - If using Deno
2. **ES Lint** (dbaeumer.vscode-eslint)
3. **Prettier** (esbenp.prettier-vscode)

**Workspace settings (`.vscode/settings.json`):**

```json
{
  // For Deno projects
  "deno.enable": true,
  "deno.lint": true,
  "deno.unstable": true,

  // For all projects
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

### Other IDEs

- **WebStorm** - Deno plugin available
- **Zed** - Built-in Deno support
- **Neovim** - Use denols LSP

---

## Verify Installation

Test that everything works:

```bash
# 1. Development server starts
deno task dev  # or npm run dev / bun run dev

# 2. Visit http://localhost:3000
# You should see your "Hello Veryfront!" page

# 3. Make a change to app/page.tsx
# Page should hot-reload automatically

# 4. Build for production
deno task build  # or npm run build / bun run build

# 5. Start production server
deno task start  # or npm start / bun start
```

If all steps succeed, you're ready to build! 🎉

---

## Troubleshooting

### "Command not found: deno/node/bun"

**Solution:** Restart your terminal after installation, or add to PATH:

```bash
# Deno (macOS/Linux)
export PATH="$HOME/.deno/bin:$PATH"

# Add to ~/.zshrc or ~/.bashrc to make permanent
```

### "Module not found"

**Deno:** Make sure imports are in `deno.json`:
```json
{
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0"
  }
}
```

**Node.js:** Run `npm install` to install dependencies.

### "Permission denied" (Deno)

**Solution:** Add required permissions:
```bash
deno run --allow-net --allow-read --allow-env --allow-write main.ts
```

Or use `--allow-all` for development:
```bash
deno run --allow-all main.ts
```

### Port already in use

**Solution:** Kill the process or use a different port:
```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9

# Or use different port
deno task dev --port 3001
```

### TypeScript errors

**Solution:** Make sure `tsconfig.json` or `deno.json` has correct compiler options:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

---

## Comparison Table

| Feature | Deno | Node.js | Bun | Cloudflare |
|---------|------|---------|-----|------------|
| **Setup Time** | ⚡ 2 min | 🐢 5 min | ⚡ 2 min | 🐢 10 min |
| **TypeScript** | Native | Via tsc | Native | Via tsc |
| **Package Manager** | JSR/npm | npm/yarn | bun | npm |
| **Build Step** | Optional | Required | Optional | Required |
| **Deploy Target** | Deno Deploy | Vercel, Railway | Self-hosted | Cloudflare |
| **Cold Start** | ~10ms | ~200ms | ~50ms | ~0ms |
| **Free Tier** | 100k req/day | Platform dependent | N/A | 100k req/day |
| **npm Packages** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Limited |

---

## Migration Guides

### From Next.js

Veryfront is largely compatible with Next.js. Follow our [Next.js Migration Guide](../guides/migration/nextjs.md).

### From Create React App

See the [React Migration Guide](../guides/migration/react.md).

### From Remix

See the [Remix Migration Guide](../guides/migration/remix.md).

---

## Next Steps

**You're all set!** Choose your next adventure:

1. **Learn the Basics**
   - [Quick Start Guide](../quick-start.md) - Build your first app in 5 minutes
   - [Routing System](../routing/README.md) - Understand file-based routing
   - [Rendering Modes](../rendering/comparison.md) - Choose your rendering strategy

2. **Build Something**
   - [Create a Blog](../guides/building-blog.md) - Step-by-step tutorial
   - [Add Authentication](../guides/authentication.md) - Secure your app
   - [Connect a Database](../guides/database.md) - Persist data

3. **Deploy to Production**
   - [Deploy to Deno Deploy](../guides/deployment/deno.md) - Recommended
   - [Deploy to Vercel](../guides/deployment/node.md) - Node.js
   - [Deploy to Cloudflare](../guides/deployment/cloudflare.md) - Edge

4. **AI Integration**
   - [AI Quick Start](../ai/getting-started.md) - Add AI in 5 minutes
   - [Build AI Tools](../guides/ai/tools.md) - Custom agent tools
   - [RAG Systems](../guides/ai/rag.md) - Knowledge retrieval

---

## Getting Help

- **Documentation:** [docs.veryfront.com](/)
- **Examples:** Check the `/examples/` directory for 19 working examples
- **Issues:** Report bugs on GitHub
- **Community:** Join discussions and get help

---

## System Requirements

### Minimum Requirements

- **RAM:** 2 GB
- **Disk:** 100 MB (plus dependencies)
- **OS:** macOS, Linux, Windows (WSL2 for Bun)
- **Runtime:** Deno 1.40+, Node.js 18+, or Bun 1.0+

### Recommended

- **RAM:** 4 GB+
- **Disk:** 1 GB+ (for node_modules)
- **OS:** macOS or Linux
- **Runtime:** Deno 1.40+ or Node.js 20+

---

**Welcome to Veryfront!** 🎉 You're ready to build fast, modern web applications.
