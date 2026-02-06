/**
 * E2E Test Fixtures
 *
 * Factory functions for creating test project structures:
 * - Basic pages, layouts, and app providers
 * - API routes and dynamic routing
 * - MDX content
 * - Component imports and dependencies
 */

import { join } from "#veryfront/compat/path/index.ts";

export interface ProjectOptions {
  /** Additional files to create in the project */
  files?: Record<string, string>;
  /** Package.json dependencies */
  dependencies?: Record<string, string>;
  /** Custom veryfront.config.ts content */
  config?: string;
}

/**
 * Create a test project directory with standard structure.
 */
export async function createProject(
  name: string,
  pageContent: string,
  options: ProjectOptions = {},
): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-${name}-` });

  const deps = {
    react: "^19.0.0",
    "react-dom": "^19.0.0",
    ...options.dependencies,
  };

  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      { name: `test-${name}`, type: "module", dependencies: deps },
      null,
      2,
    ),
  );

  await Deno.writeTextFile(
    join(projectDir, "veryfront.config.ts"),
    options.config ?? `export default { fs: { type: "local" } };`,
  );

  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "pages", "index.tsx"), pageContent);

  if (options.files) {
    for (const [filePath, content] of Object.entries(options.files)) {
      const fullPath = join(projectDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
  }

  return projectDir;
}

// ============================================================================
// Pre-built Page Fixtures
// ============================================================================

export const pages = {
  /** Basic page with no imports */
  basic: `
export default function Home() {
  return <div id="content">Hello World</div>;
}
`,

  /** Page with veryfront/head import */
  withHead: `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Test Page</title></Head>
      <div id="content">Page with Head</div>
    </>
  );
}
`,

  /** Page with veryfront/router import */
  withRouter: `
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return <div id="content">Path: {router.pathname}</div>;
}
`,

  /** Page with both head and router */
  withHeadAndRouter: `
import { Head } from "veryfront/head";
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return (
    <>
      <Head><title>Multi Import</title></Head>
      <div id="content">Path: {router.pathname}</div>
    </>
  );
}
`,

  /** Client component with useState */
  clientComponent: `
"use client";
import { useState } from "react";

export default function Counter() {
  const [count] = useState(0);
  return <div id="content">Count: {count}</div>;
}
`,

  /** Page using pageContext */
  withPageContext: `
import { usePageContext } from "veryfront/context";

export const frontmatter = {
  title: "Test Title",
  customMeta: "custom-value",
};

export default function Home() {
  const ctx = usePageContext();
  return (
    <div id="content">
      <h1>Title: {ctx?.frontmatter?.title || "none"}</h1>
    </div>
  );
}
`,
};

// ============================================================================
// Pre-built Layout Fixtures
// ============================================================================

export const layouts = {
  /** Basic layout with header/footer */
  basic: `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="layout-wrapper">
      <header id="layout-header">Header</header>
      <main>{children}</main>
      <footer id="layout-footer">Footer</footer>
    </div>
  );
}
`,

  /** Layout with Head component */
  withHead: `
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Layout Title</title></Head>
      <div id="layout-wrapper">{children}</div>
    </>
  );
}
`,

  /** Layout with router hook */
  withRouter: `
import { useRouter } from "veryfront/router";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div id="layout-wrapper">
      <nav id="layout-nav">Path: {router.pathname}</nav>
      {children}
    </div>
  );
}
`,

  /** Layout using pageContext */
  withPageContext: `
import { Head } from "veryfront/head";
import { usePageContext } from "veryfront/context";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = usePageContext();
  const title = ctx?.frontmatter?.title || "Default";
  return (
    <>
      <Head><title>{title}</title></Head>
      <div id="layout-wrapper">{children}</div>
    </>
  );
}
`,
};

// ============================================================================
// Pre-built App Provider Fixtures
// ============================================================================

export const appProviders = {
  /** Basic app provider wrapper */
  basic: `
export default function App({ children }: { children: React.ReactNode }) {
  return (
    <div id="app-wrapper">
      <header id="app-header">App Header</header>
      {children}
    </div>
  );
}
`,
};

// ============================================================================
// Pre-built Component Fixtures
// ============================================================================

export const components = {
  /** Simple component */
  simple: `
export default function MyComponent() {
  return <div id="my-component">Component works!</div>;
}
`,

  /** Component with props */
  withProps: `
export function Button({ label }: { label: string }) {
  return <button id="button">{label}</button>;
}
`,

  /** Header component */
  header: `
export function Header() {
  return <header id="header">Site Header</header>;
}
`,

  /** Footer component */
  footer: `
export function Footer() {
  return <footer id="footer">Site Footer</footer>;
}
`,
};

// ============================================================================
// Pre-built API Route Fixtures
// ============================================================================

export const apiRoutes = {
  /** Simple JSON response */
  json: `
export function GET() {
  return Response.json({ message: "Hello", timestamp: Date.now() });
}
`,

  /** Custom status code */
  customStatus: `
export function GET() {
  return new Response(JSON.stringify({ status: "created" }), {
    status: 201,
    headers: { "Content-Type": "application/json" }
  });
}
`,

  /** POST handler */
  post: `
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: body });
}
`,
};

// ============================================================================
// Pre-built MDX Content Fixtures
// ============================================================================

export const mdxContent = {
  /** Basic markdown */
  basic: `---
title: Test Post
---

# Welcome

This is **markdown** content.

- Item 1
- Item 2
`,

  /** MDX with React components */
  withComponents: `
import { Head } from "veryfront/head";

<Head><title>MDX Page</title></Head>

# MDX with Components

<div id="react-in-mdx">React component in MDX!</div>
`,

  /** MDX with inline component definition */
  withInlineComponent: `
export function Callout({ children }) {
  return <div className="callout" id="callout">{children}</div>;
}

# Documentation

<Callout>Important note!</Callout>
`,
};

// ============================================================================
// Helper Functions for Common Project Patterns
// ============================================================================

/**
 * Create a project with a basic layout.
 */
export function createLayoutProject(
  name: string,
  pageContent: string = pages.basic,
  layoutContent: string = layouts.basic,
): Promise<string> {
  return createProject(name, pageContent, {
    files: { "pages/layout.tsx": layoutContent },
  });
}

/**
 * Create a project with app provider.
 */
export function createAppProject(
  name: string,
  pageContent: string = pages.basic,
  appContent: string = appProviders.basic,
): Promise<string> {
  return createProject(name, pageContent, {
    files: { "components/app.tsx": appContent },
  });
}

/**
 * Create a project with nested layouts.
 */
export function createNestedLayoutProject(name: string): Promise<string> {
  return createProject(name, pages.basic, {
    files: {
      "pages/layout.tsx": layouts.basic,
      "pages/dashboard/layout.tsx": `
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="dashboard-layout">
      <aside id="sidebar">Sidebar</aside>
      <div id="dashboard-main">{children}</div>
    </div>
  );
}
`,
      "pages/dashboard/index.tsx": `
export default function Dashboard() {
  return <div id="dashboard-content">Dashboard</div>;
}
`,
    },
  });
}

/**
 * Create a project with relative imports from pages to components.
 */
export function createComponentImportProject(name: string): Promise<string> {
  return createProject(
    name,
    `
import MyComponent from "../components/MyComponent";

export default function Home() {
  return (
    <div id="page">
      <h1>Page with Component</h1>
      <MyComponent />
    </div>
  );
}
`,
    {
      files: {
        "components/MyComponent.tsx": components.simple,
      },
    },
  );
}

/**
 * Create a project with dynamic routes.
 */
export function createDynamicRouteProject(name: string): Promise<string> {
  return createProject(name, pages.basic, {
    files: {
      "pages/blog/[slug].tsx": `
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <div id="blog-post">Post: {params?.slug || "unknown"}</div>;
}
`,
    },
  });
}

/**
 * Create a project with API routes.
 */
export function createApiProject(name: string): Promise<string> {
  return createProject(name, pages.basic, {
    files: {
      "pages/api/hello.ts": apiRoutes.json,
    },
  });
}

/**
 * Create a project with MDX pages.
 */
export function createMdxProject(name: string): Promise<string> {
  return createProject(name, pages.basic, {
    files: {
      "pages/blog/post.mdx": mdxContent.basic,
    },
  });
}
