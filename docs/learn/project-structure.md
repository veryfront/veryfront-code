# Project Structure

This guide covers the recommended directory structure and file conventions for Veryfront applications.

## Top-Level Structure

```
my-app/
├── app/                    # App Router pages and layouts
├── ai/                     # AI agents, tools, and resources
├── components/             # Shared React components
├── lib/                    # Utility functions and helpers
├── public/                 # Static assets
├── veryfront.config.ts     # Framework configuration
├── deno.json               # Deno configuration (or package.json)
└── .env                    # Environment variables
```

## `app/` Directory

The `app/` directory uses file-system based routing where folders define routes.

### File Conventions

| File | Purpose |
|------|---------|
| `page.tsx` | Page component for the route |
| `layout.tsx` | Shared layout wrapping child routes |
| `loading.tsx` | Loading UI while data fetches |
| `error.tsx` | Error boundary for the segment |
| `not-found.tsx` | 404 page for the segment |
| `route.ts` | API endpoint handler |

### Example Structure

```
app/
├── layout.tsx              # Root layout (required)
├── page.tsx                # Home page (/)
├── globals.css             # Global styles
├── about/
│   └── page.tsx            # /about
├── blog/
│   ├── layout.tsx          # Blog layout
│   ├── page.tsx            # /blog
│   └── [slug]/
│       ├── page.tsx        # /blog/:slug
│       └── loading.tsx     # Loading state
├── dashboard/
│   ├── layout.tsx          # Dashboard layout (with auth)
│   ├── page.tsx            # /dashboard
│   └── settings/
│       └── page.tsx        # /dashboard/settings
└── api/
    ├── hello/
    │   └── route.ts        # /api/hello
    └── posts/
        ├── route.ts        # /api/posts (GET, POST)
        └── [id]/
            └── route.ts    # /api/posts/:id (GET, PUT, DELETE)
```

### Route Segments

| Pattern | Example | Matches |
|---------|---------|---------|
| `[slug]` | `blog/[slug]` | `/blog/hello-world` |
| `[...slug]` | `docs/[...slug]` | `/docs/a/b/c` |
| `[[...slug]]` | `shop/[[...slug]]` | `/shop`, `/shop/a`, `/shop/a/b` |
| `(group)` | `(marketing)/about` | `/about` (no URL segment) |

## `ai/` Directory

The `ai/` directory contains AI-related code. Files are automatically discovered and registered.

```
ai/
├── agents/                 # Agent definitions
│   ├── assistant.ts        # Default agent
│   └── support.ts          # Support agent
├── tools/                  # Tool definitions
│   ├── search.ts           # Search tool
│   ├── create-ticket.ts    # Ticket creation tool
│   └── send-email.ts       # Email tool
├── prompts/                # Reusable prompts
│   └── system.ts           # System prompt
└── resources/              # MCP resources
    └── users/
        └── [id]/
            └── resource.ts # /users/:id resource
```

### Auto-Discovery Rules

- Files in `ai/agents/` exporting `agent()` are registered as agents
- Files in `ai/tools/` exporting `tool()` are registered as tools
- Files in `ai/resources/` exporting `resource()` are registered as MCP resources
- File names become identifiers (e.g., `search.ts` → tool named `search`)

## `pages/` Directory (Alternative)

Use `pages/` instead of `app/` for traditional file-based routing.

```
pages/
├── _app.tsx                # Custom App component
├── _document.tsx           # Custom Document
├── index.tsx               # Home page (/)
├── about.tsx               # /about
├── blog/
│   ├── index.tsx           # /blog
│   └── [slug].tsx          # /blog/:slug
└── api/
    └── hello.ts            # /api/hello
```

Do not mix `app/` and `pages/` in the same project.

## `components/` Directory

Shared React components used across multiple pages.

```
components/
├── ui/                     # Base UI components
│   ├── Button.tsx
│   ├── Card.tsx
│   └── Input.tsx
├── layout/                 # Layout components
│   ├── Header.tsx
│   ├── Footer.tsx
│   └── Sidebar.tsx
└── features/               # Feature-specific components
    ├── auth/
    │   └── LoginForm.tsx
    └── blog/
        └── PostCard.tsx
```

## `lib/` Directory

Utility functions, database connections, and business logic.

```
lib/
├── db.ts                   # Database connection
├── auth.ts                 # Authentication utilities
├── utils.ts                # General utilities
└── api/                    # API client functions
    └── posts.ts
```

## `public/` Directory

Static assets served from the root URL.

```
public/
├── favicon.ico             # /favicon.ico
├── logo.png                # /logo.png
├── robots.txt              # /robots.txt
└── images/
    └── hero.jpg            # /images/hero.jpg
```

## Configuration Files

### veryfront.config.ts

Main framework configuration.

```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  projectName: 'my-app',
  runtime: 'deno',
  rendering: {
    default: 'ssr',
  },
  ai: {
    enabled: true,
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    },
  },
});
```

### deno.json

Deno-specific configuration.

```json
{
  "tasks": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "start": "veryfront start"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "jsr:@veryfront/core",
    "veryfront/": "jsr:@veryfront/core/",
    "react": "npm:react@^18",
    "react-dom": "npm:react-dom@^18"
  }
}
```

### package.json (Node.js/Bun)

For Node.js or Bun projects.

```json
{
  "name": "my-app",
  "scripts": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "start": "veryfront start"
  },
  "dependencies": {
    "veryfront": "^0.0.6",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  }
}
```

### .env

Environment variables. Never commit this file.

```
# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Database
DATABASE_URL=postgres://...

# App
PUBLIC_APP_URL=https://example.com
```

## Path Aliases

Configure path aliases for cleaner imports.

### Deno (deno.json)

```json
{
  "imports": {
    "@/": "./",
    "@/components/": "./components/",
    "@/lib/": "./lib/"
  }
}
```

### Node.js (tsconfig.json)

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"],
      "@/components/*": ["./components/*"],
      "@/lib/*": ["./lib/*"]
    }
  }
}
```

Usage:

```typescript
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/db';
```

## Colocation

Keep related files together when they're specific to a route.

```
app/
└── dashboard/
    ├── page.tsx
    ├── dashboard.module.css    # Route-specific styles
    ├── use-dashboard.ts        # Route-specific hook
    └── DashboardChart.tsx      # Route-specific component
```

For shared components, use the `components/` directory.

## Recommended Practices

1. **Use `app/` router for new projects** - More features and better patterns
2. **Keep components in `components/`** - Unless they're route-specific
3. **Use path aliases** - Cleaner imports, easier refactoring
4. **Colocate when appropriate** - Keep related files together
5. **Never commit `.env`** - Use `.env.example` for documentation
