---
title: Project Structure
description: Overview of the Veryfront project structure and file organization
category: learn
level: beginner
keywords:
  - structure
  - organization
  - directories
  - files
  - layout
reading_time: 5 min
prev_page: /learn/quickstart.md
next_page: /routing/README.md
---

# Project Structure

This guide provides an overview of the recommended directory structure for a Veryfront application. While flexible, following these conventions ensures optimal compatibility with auto-discovery features.

## Complete Project Layout

A full-featured Veryfront application typically looks like this:

```text
my-app/
├── app/                        # App Router (Recommended)
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Home page
│   ├── globals.css             # Global styles
│   ├── api/                    # API Routes
│   │   └── hello/
│   │       └── route.ts        # /api/hello endpoint
│   └── dashboard/
│       ├── layout.tsx          # Dashboard layout
│       ├── page.tsx            # /dashboard page
│       └── loading.tsx         # Dashboard loading state
│
├── ai/                         # AI Engine (Optional)
│   ├── agents/                 # Agent definitions
│   │   └── assistant.ts        # Auto-discovered agent
│   ├── tools/                  # Tool definitions
│   │   └── search.ts           # Auto-discovered tool
│   ├── prompts/                # Reusable prompts
│   │   └── system.ts
│   └── resources/              # Knowledge base
│       └── policy.md
│
├── components/                 # Shared UI Components
│   ├── Button.tsx
│   └── Card.tsx
│
├── lib/                        # Shared Utilities
│   ├── db.ts
│   └── utils.ts
│
├── public/                     # Static Assets
│   ├── favicon.ico
│   ├── logo.png
│   └── robots.txt
│
├── veryfront.config.ts         # Framework Configuration
├── deno.json                   # Deno Configuration
└── .env                        # Environment Variables
```

## Top-Level Directories

| Directory | Description |
|-----------|-------------|
| `app/` | **Core.** Contains your application's routes, pages, and layouts using the App Router. |
| `ai/` | **AI Engine.** Contains all AI-related logic. Files here are auto-discovered by the framework. |
| `components/`| **UI.** Reusable React components used across multiple pages. |
| `lib/` | **Logic.** Helper functions, database connections, and business logic. |
| `public/` | **Assets.** Static files served from the root URL (e.g., `/logo.png`). |
| `pages/` | **Legacy.** Alternative routing directory (Pages Router). Do not use with `app/`. |

## `app/` Directory Conventions

The `app/` directory uses file-system based routing where folders define routes and special files define UI.

- `page.tsx`: The UI for a route.
- `layout.tsx`: Shared UI for a route and its children.
- `loading.tsx`: Loading UI shown while data fetches.
- `error.tsx`: Error UI for handling runtime errors.
- `route.ts`: API endpoint handler (backend logic).

**Example:**
- `app/page.tsx` → `/`
- `app/blog/page.tsx` → `/blog`
- `app/blog/[slug]/page.tsx` → `/blog/123`

## `ai/` Directory Conventions

The `ai/` directory is special. Veryfront automatically scans this folder to register AI capabilities without manual wiring.

- `agents/*.ts`: Files exporting an `agent()` definition are registered as agents.
- `tools/*.ts`: Files exporting a `tool()` definition are registered as tools.
- `resources/*`: Files (MD/JSON) are exposed as MCP resources.

**Example:**
- `ai/tools/weather.ts` → Tool named `"weather"` available to all agents.

## Configuration Files

- **`veryfront.config.ts`**: The main configuration file for the framework. Use this to configure AI providers, build settings, and middleware.
- **`deno.json`**: (Deno projects) Manages dependencies and tasks.
- **`package.json`**: (Node.js/Bun projects) Manages dependencies and scripts.
- **`.env`**: Stores secret keys (API keys, database URLs). **Never commit this file.**

## Best Practices

1.  **Colocation**: Keep tests and specific components next to the pages that use them if they aren't shared.
2.  **Barrel Exports**: Use `index.ts` files in `components/` or `lib/` to cleaner imports (e.g., `import { Button } from '@/components'`).
3.  **Type Safety**: Use TypeScript for everything. Veryfront is optimized for it.
