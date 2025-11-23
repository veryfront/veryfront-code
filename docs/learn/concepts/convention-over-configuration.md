---
title: "Convention over Configuration"
description: "Understanding Veryfront's philosophy of minimizing boilerplate through smart defaults"
category: learn
level: beginner
keywords: ["concepts", "philosophy", "conventions", "configuration", "auto-discovery"]
reading_time: 5 min
prev_page: /learn/project-structure
next_page: /reference/configuration/README
---

# Convention over Configuration

Veryfront is designed around the principle of **Convention over Configuration**. This means the framework makes logical decisions for you based on how you name files and structure folders, rather than requiring you to write verbose configuration files.

This approach drastically reduces boilerplate code and lets you focus on building your application logic.

## Core Conventions

### 1. File-System Routing

Instead of defining a central router file (like `router.js` or `routes.ts`), Veryfront infers your routes from your file structure.

**The Convention:**
- A file named `page.tsx` creates a route.
- Folders define the URL path.

**Example:**
- **You create:** `app/blog/page.tsx`
- **Veryfront creates:** Route `/blog`
- **Boilerplate saved:** No `Route` definitions, no imports in a central file.

### 2. AI Auto-Discovery

Instead of manually registering every tool, agent, and resource with a central registry, Veryfront scans your `ai/` directory.

**The Convention:**
- `ai/tools/*.ts` → Registered as Tools
- `ai/agents/*.ts` → Registered as Agents
- `ai/resources/*` → Exposed as Resources

**Example:**
**File:** `ai/tools/weather.ts`
```typescript
export default tool({ ... });
```

**Usage:**
```typescript
agent({
  tools: {
    weather: true // ✅ Automatically available by name!
  }
});
```

**Boilerplate saved:** No manual `registry.registerTool('weather', weatherTool)` calls.

### 3. Configuration Defaults

Veryfront works out-of-the-box with zero configuration for most projects.

**The Convention:**
- **Runtime:** Auto-detected (Deno, Node, Bun).
- **Port:** Default `3000` (or next available).
- **Rendering:** Default `SSR` (Server-Side Rendering).

You only need to create `veryfront.config.ts` when you want to *override* these defaults.

## Benefits

1.  **Faster Onboarding**: New developers don't need to learn a complex configuration schema to start.
2.  **Less Code**: Fewer lines of code means fewer bugs and easier maintenance.
3.  **Predictability**: Once you know the conventions, you know exactly where to look for code.

## Directory Configuration Matrix

| Directory | Default Path | Configurable? | How to Configure |
| :--- | :--- | :--- | :--- |
| **App Router** | `app/` | ✅ Yes | `directories.app` |
| **Pages Router** | `pages/` | ✅ Yes | `directories.pages` |
| **AI Tools** | `ai/tools/` | ✅ Yes | `ai.tools.discovery.paths` |
| **AI Agents** | `ai/agents/` | ✅ Yes | `ai.agents.discovery.paths` |
| **Components** | `components/` | ✅ Yes | `directories.components` |
| **Public Assets** | `public/` | ✅ Yes | `assets.publicDir` |
| **Build Output** | `.veryfront/` | ✅ Yes | `build.outDir` |

## "Ejecting" from Conventions

Conventions are great, but sometimes you need control. Veryfront allows you to override conventions via `veryfront.config.ts`.

### Overriding AI Discovery

By default, Veryfront looks in `ai/tools` and `ai/agents`. You can change this:

```typescript
// veryfront.config.ts
export default defineConfig({
  // Move the entire AI module to src/ai
  directories: {
    ai: 'src/ai',
  },
  ai: {
    enabled: true,
    tools: {
      discovery: {
        // Look in 'custom/tools' IN ADDITION to the default location
        paths: ['custom/tools'], 
      },
    },
    agents: {
      discovery: {
        // Disable auto-discovery for agents entirely
        enabled: false, 
      },
    },
  },
});
```

**Note:** `directories.ai` sets the base folder. `ai.tools.discovery.paths` configures specific scan paths. If you set `paths`, Veryfront will scan those paths.

### Overriding Routing

By default, Veryfront auto-detects `app/` or `pages/`. You can force a specific router:

```typescript
// veryfront.config.ts
export default defineConfig({
  // Force usage of App Router even if 'pages/' exists
  router: 'app', 
});
```

### Overriding Build Output

By default, build artifacts go to `.veryfront`. You can change this:

```typescript
// veryfront.config.ts
export default defineConfig({
  build: {
    // Output to 'dist' folder instead
    outDir: 'dist', 
  },
});
```

## Summary

| Feature | Convention | Configuration Alternative |
| :--- | :--- | :--- |
| **Routing** | `app/page.tsx` | N/A (Core Architecture) |
| **AI Tools** | `ai/tools/*.ts` | Manual registry calls |
| **Layouts** | `app/layout.tsx` | N/A (Core Architecture) |
| **API** | `app/api/route.ts` | N/A (Core Architecture) |
| **404 Page** | `app/not-found.tsx` | Default 404 |

By embracing these conventions, you build apps faster and with less friction.
