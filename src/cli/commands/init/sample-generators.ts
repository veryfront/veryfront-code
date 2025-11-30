/**
 * Sample file generators for different templates
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { PATHS } from "@veryfront/utils/paths.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { createFileSystem, type FileSystem } from "../../../platform/compat/fs.ts";

let fs: FileSystem;

/**
 * Creates sample files for pages-router template
 *
 * @param projectDir - Root directory of the project
 * @throws {Error} If file creation fails
 *
 * @example
 * ```ts
 * await createSampleFiles('/path/to/project')
 * ```
 */
export async function createSampleFiles(projectDir: string): Promise<void> {
  fs = createFileSystem();
  // Create index.mdx
  const indexMdx = `---
title: Welcome
description: Built with Veryfront
---

import Button from '../components/Button.jsx'

# Welcome to Veryfront

This is your first Veryfront page! Edit this file to see live changes.

## Features

- 🚀 **Full ESM** - No CommonJS dependencies
- 📝 **MDX Support** - Write React components in Markdown
- 🎨 **Tailwind CSS** - Utility-first CSS framework
- ⚡ **Hot Reload** - See changes instantly
- 🏗️ **SSR Ready** - Server-side rendering support

<Button>Get Started</Button>

## Next Steps

1. Edit this file to see changes
2. Add new pages in the \`pages/\` directory
3. Create components in the \`components/\` directory
4. Run \`veryfront dev\` to start the development server
`;

  await fs.writeTextFile(join(projectDir, PATHS.PAGES_DIR, "index.mdx"), indexMdx);

  // Create example API route: pages/api/hello.ts
  try {
    await ensureDir(join(projectDir, PATHS.PAGES_DIR, "api"));
    const apiHello = `export async function GET(_ctx) {
  return new Response("Hello from GET /api/hello");
}

export async function POST(ctx) {
  let body = {};
  try { body = await ctx.request.json(); } catch (error) { logger.debug("POST /api/hello JSON parse failed", error); }
  return Response.json({ ok: true, body });
}
`;
    await fs.writeTextFile(join(projectDir, PATHS.PAGES_DIR, "api", "hello.ts"), apiHello);
  } catch (error) {
    logger.debug("Creating sample API route failed (non-fatal)", error);
  }

  // Create Button component
  const buttonComponent = `import React from "react";

export default function Button({ children = "Click me" }) {
  return (<button type="button" onClick={() => alert('Hello from Veryfront!')}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-200"
    >
      {children}
    </button>);
}
`;

  await fs.writeTextFile(join(projectDir, PATHS.COMPONENTS_DIR, "Button.jsx"), buttonComponent);

  // Create global styles
  const globalStyles = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

  await fs.writeTextFile(join(projectDir, PATHS.STYLES_DIR, "globals.css"), globalStyles);

  logger.debug("Created sample files");
}

/**
 * Creates sample files for app-router template
 *
 * @param projectDir - Root directory of the project
 * @throws {Error} If file creation fails
 *
 * @example
 * ```ts
 * await createAppRouterSample('/path/to/project')
 * ```
 */
export async function createAppRouterSample(projectDir: string): Promise<void> {
  if (!fs) fs = createFileSystem();
  // Create app directories
  await ensureDir(join(projectDir, "app"));
  await ensureDir(join(projectDir, "app", "api", "echo"));

  const layout = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>{children}</body>
    </html>
  );
}
`;
  await fs.writeTextFile(join(projectDir, "app", "layout.tsx"), layout);

  const page = `export default function Page() {
  return <h1>Veryfront App Router</h1>;
}
`;
  await fs.writeTextFile(join(projectDir, "app", "page.tsx"), page);

  const apiRoute = `export const GET = (req: Request) => {
  const url = new URL(req.url);
  return Response.json({ ok: true, q: Object.fromEntries(url.searchParams) });
};

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  return Response.json({ ok: true, body });
};
`;
  await fs.writeTextFile(join(projectDir, "app", "api", "echo", "route.ts"), apiRoute);

  // Keep the App Router scaffold minimal; no pages/ or legacy scaffolds
  logger.debug("Created App Router sample files (minimal)");
}

/**
 * Creates sample files for app-router-api template
 * Extends app-router with error and loading components
 *
 * @param projectDir - Root directory of the project
 * @throws {Error} If file creation fails
 *
 * @example
 * ```ts
 * await createAppRouterApiSample('/path/to/project')
 * ```
 */
export async function createAppRouterApiSample(projectDir: string): Promise<void> {
  if (!fs) fs = createFileSystem();
  await createAppRouterSample(projectDir);
  // Add reserved component samples
  const loading =
    `export default function Loading(){ return <p style={{padding:12}}>Loading…</p>; }`;
  await fs.writeTextFile(join(projectDir, "app", "loading.tsx"), loading);
  const error =
    `export default function ErrorBoundary({ error }:{ error: Error }){ return <div style={{color:'#b91c1c'}}>Error: {error.message}</div>; }`;
  await fs.writeTextFile(join(projectDir, "app", "error.tsx"), error);
}

/**
 * Creates sample files for rsc-demo template
 * Demonstrates experimental React Server Components
 *
 * @param projectDir - Root directory of the project
 * @throws {Error} If file creation fails
 *
 * @example
 * ```ts
 * await createRscDemoSample('/path/to/project')
 * ```
 */
export async function createRscDemoSample(projectDir: string): Promise<void> {
  if (!fs) fs = createFileSystem();
  // Create an App Router scaffold first
  await createAppRouterSample(projectDir);
  // Overwrite root page with links to the RSC demo shell
  const page = `export default function Page() {
  return (
    <div>
      <h1>Veryfront R S C Demo</h1>
      <p>Try the experimental R S C page shell:</p>
      <ul>
        <li><a href="/_veryfront/rsc/page?name=Alice">RSC page (Alice)</a></li>
        <li><a href="/_veryfront/rsc/page?name=Bob">RSC page (Bob)</a></li>
      </ul>
      <p style={{marginTop:16}}>Enable with VERYFRONT_EXPERIMENTAL_RSC=1</p>
    </div>
  );
}
`;
  await fs.writeTextFile(join(projectDir, "app", "page.tsx"), page);
}
