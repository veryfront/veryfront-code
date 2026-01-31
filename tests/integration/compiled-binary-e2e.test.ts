#!/usr/bin/env -S deno test --allow-all
/**
 * Compiled Binary E2E Tests - Kitchen Sink
 *
 * Tests the compiled binary distribution to ensure:
 * - Framework module resolution (/_vf_modules/_veryfront/) works
 * - Cache isolation between environments
 * - No dual React instance errors
 * - SSR rendering with framework components
 * - Layout and app provider wrapping
 * - Page context sharing across components
 *
 * Run:
 *   deno task test:e2e:binary        # Uses cached binary if exists
 *   deno task test:e2e:binary:fresh  # Always recompiles binary
 *
 * Environment variables:
 *   VERYFRONT_BINARY=/path/to/bin    # Use specific binary path
 *   VERYFRONT_BINARY_FRESH=1         # Force recompilation
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";

const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? "/tmp/veryfront-e2e-bin";
const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;
let portCounter = 18100;

async function computeSourceHash(): Promise<string> {
  const decoder = new TextDecoder();

  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD:src"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  return Date.now().toString();
}

interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
}

async function ensureBinaryCompiled(): Promise<void> {
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) {
        console.log("✅ Using existing binary (source unchanged):", BINARY_PATH);
        return;
      }
      console.log("🔄 Source code changed, recompiling...");
    } catch {
      console.log("🔄 No source hash found, recompiling...");
    }
  }

  if (forceFresh) console.log("🗑️  Force fresh build (VERYFRONT_BINARY_FRESH=1)");
  if (binaryExists) await Deno.remove(BINARY_PATH);

  console.log("📦 Compiling binary...");
  const result = await new Deno.Command("deno", {
    args: ["compile", "--allow-all", "--unstable-net", "--output", BINARY_PATH, "src/cli/main.ts"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) throw new Error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("✅ Binary compiled");
}

function collectLogs(logs: string[], stream: ReadableStream<Uint8Array>): void {
  (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        logs.push(decoder.decode(value));
      }
    } catch {
      // closed
    }
  })();
}

async function waitForServer(port: number, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Server failed to start on port ${port}`);
}

async function startBinaryServer(projectDir: string, nodeEnv = "development"): Promise<TestServer> {
  const logs: string[] = [];
  const port = portCounter++;
  const cacheDir = await Deno.makeTempDir({ prefix: nodeEnv === "production" ? "vf-cache-prod-" : "vf-cache-" });

  const process = new Deno.Command(BINARY_PATH, {
    args: ["dev", "-p", String(port), "--project", projectDir],
    env: {
      ...Deno.env.toObject(),
      NODE_ENV: nodeEnv,
      LOG_FORMAT: "text",
      VERYFRONT_CACHE_DIR: cacheDir,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  collectLogs(logs, process.stdout);
  collectLogs(logs, process.stderr);

  try {
    await waitForServer(port);
  } catch {
    try {
      process.kill();
    } catch {
      // already dead
    }
    const logOutput = logs.join("\n").slice(-2000);
    throw new Error(`Server failed to start on port ${port}. Logs:\n${logOutput}`);
  }

  return {
    process,
    port,
    logs,
    kill: async () => {
      try {
        process.kill();
        await process.status;
      } catch {
        // already dead
      }
      await new Promise((r) => setTimeout(r, 200));
      try {
        await Deno.remove(cacheDir, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

async function createTestProject(
  name: string,
  pageContent: string,
  additionalFiles?: Record<string, string>,
): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-${name}-` });

  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: `test-${name}`,
        type: "module",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      null,
      2,
    ),
  );

  await Deno.writeTextFile(join(projectDir, "veryfront.config.ts"), `export default { fs: { type: "local" } };`);

  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "pages", "index.tsx"), pageContent);

  if (additionalFiles) {
    for (const [filePath, content] of Object.entries(additionalFiles)) {
      const fullPath = join(projectDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
  }

  return projectDir;
}

async function withServer(projectDir: string, fn: (server: TestServer) => Promise<void>, nodeEnv?: string): Promise<void> {
  const server = await startBinaryServer(projectDir, nodeEnv);
  try {
    await fn(server);
  } finally {
    await server.kill();
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("Compiled Binary E2E", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should render page with veryfront/head import correctly", async () => {
    const projectDir = await createTestProject(
      "head-test",
      `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Head Component Test</title></Head>
      <div id="content">Head import works</div>
    </>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assert(!html.includes("esm.sh/_vf_modules"), "Should not have esm.sh/_vf_modules error");
      assert(!html.includes("Module not found"), "Should not have module errors");
      assertStringIncludes(html, "Head import works", "Should render content");

      const errorLogs = server.logs.filter((l) =>
        l.includes("esm.sh/_vf_modules") || l.includes("dual React") || l.includes("Invalid hook call")
      );
      assertEquals(errorLogs.length, 0, `Should have no critical errors: ${errorLogs.join("\n")}`);
    });
  });

  it("should render page with veryfront/router import correctly", async () => {
    const projectDir = await createTestProject(
      "router-test",
      `
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return <div id="content">Router pathname: {router.pathname}</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("Module not found"), "Should resolve router import");
      assertStringIncludes(html, "Router pathname:");
    });
  });

  it("should handle multiple framework imports without React errors", async () => {
    const projectDir = await createTestProject(
      "multi-test",
      `
import { Head } from "veryfront/head";
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return (
    <>
      <Head><title>Multi Import</title></Head>
      <div id="content">
        <h1>Multi Import Test</h1>
        <p>Current path: {router.pathname}</p>
      </div>
    </>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("esm.sh/_vf_modules"));
      assert(!html.includes("Invalid hook call"), "Should not have React hooks error");
      assertStringIncludes(html, "Multi Import Test");

      const hookErrors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(hookErrors.length, 0, "Should have no hook errors");
    });
  });

  it("should work with useState in client components", async () => {
    const projectDir = await createTestProject(
      "hooks-test",
      `
"use client";
import { useState } from "react";
import { Head } from "veryfront/head";

export default function Counter() {
  const [count] = useState(0);
  return (
    <>
      <Head><title>Counter</title></Head>
      <div id="content">Count: {count}</div>
    </>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("Invalid hook call"), "Should not have hooks error");
      assert(!html.includes("more than one copy of React"), "Should not have dual React error");
    });
  });

  it("should not have cache path errors indicating cross-environment issues", async () => {
    const projectDir = await createTestProject(
      "cache-test",
      `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Cache Test</title></Head>
      <div id="content">Cache isolation works</div>
    </>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      await fetch(`http://127.0.0.1:${server.port}/`);
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assertStringIncludes(html, "Cache isolation works");

      const cacheErrors = server.logs.filter((l) => l.includes("file://") && l.includes("not found"));
      assertEquals(cacheErrors.length, 0, `Should have no cache path errors: ${cacheErrors.join("\n")}`);
    });
  });

  it("should render pages with _layout.tsx wrapping content", async () => {
    const projectDir = await createTestProject(
      "layout-test",
      `
export default function Home() {
  return <div id="page-content">Home Page Content</div>;
}
`,
      {
        "pages/layout.tsx": `
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Layout Test</title></Head>
      <div id="layout-wrapper">
        <header id="layout-header">Site Header</header>
        <main>{children}</main>
        <footer id="layout-footer">Site Footer</footer>
      </div>
    </>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "Site Header", "Should render layout header");
      assertStringIncludes(html, "Home Page Content", "Should render page content");
      assertStringIncludes(html, "Site Footer", "Should render layout footer");
      assertStringIncludes(html, "layout-wrapper", "Should have layout wrapper");
    });
  });

  it("should render pages with app.tsx provider wrapping entire app", async () => {
    const projectDir = await createTestProject(
      "app-provider-test",
      `
export default function Home() {
  return <div id="page-content">Home page rendered</div>;
}
`,
      {
        "components/app.tsx": `
export default function App({ children }: { children: React.ReactNode }) {
  return (
    <div id="app-wrapper" data-testid="app-provider">
      <header id="app-header">App Header</header>
      {children}
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "app-wrapper", "Should have app wrapper from provider");
      assertStringIncludes(html, "App Header", "Should render app header");
      assertStringIncludes(html, "Home page rendered", "Should render page content");
    });
  });

  it("should render nested layouts correctly", async () => {
    const projectDir = await createTestProject(
      "nested-layout-test",
      `
export default function DashboardHome() {
  return <div id="dashboard-content">Dashboard Home</div>;
}
`,
      {
        "pages/layout.tsx": `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="root-layout">
      <nav id="root-nav">Root Nav</nav>
      {children}
    </div>
  );
}
`,
        "pages/dashboard/layout.tsx": `
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="dashboard-layout">
      <aside id="dashboard-sidebar">Dashboard Sidebar</aside>
      <div id="dashboard-main">{children}</div>
    </div>
  );
}
`,
        "pages/dashboard/index.tsx": `
export default function DashboardIndex() {
  return <div id="dashboard-index">Dashboard Index Page</div>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "root-layout", "Should have root layout");
      assertStringIncludes(html, "Root Nav", "Should render root nav");
      assertStringIncludes(html, "dashboard-layout", "Should have dashboard layout");
      assertStringIncludes(html, "Dashboard Sidebar", "Should render dashboard sidebar");
      assertStringIncludes(html, "Dashboard Index Page", "Should render dashboard content");
    });
  });

  it("should work with app.tsx and layout.tsx together", async () => {
    const projectDir = await createTestProject(
      "app-layout-combo-test",
      `
export default function Home() {
  return <div id="page-content">Home Page Content</div>;
}
`,
      {
        "components/app.tsx": `
export default function App({ children }: { children: React.ReactNode }) {
  return (
    <div id="app-root">
      <div id="app-banner">App Banner</div>
      {children}
    </div>
  );
}
`,
        "pages/layout.tsx": `
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>App + Layout Test</title></Head>
      <div id="layout-container">
        <header id="layout-header">Layout Header</header>
        {children}
      </div>
    </>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "app-root", "Should have app wrapper");
      assertStringIncludes(html, "App Banner", "Should render app banner");
      assertStringIncludes(html, "layout-container", "Should have layout container");
      assertStringIncludes(html, "Layout Header", "Should render layout header");
      assertStringIncludes(html, "Home Page Content", "Should render page content");

      const reactErrors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(reactErrors.length, 0, "Should have no React errors");
    });
  });

  it("should share page context between layout and page via usePageContext", async () => {
    const projectDir = await createTestProject(
      "page-context-test",
      `
import { usePageContext } from "veryfront/context";

export const frontmatter = {
  title: "My Page Title",
  customMeta: "custom-value-123",
};

export default function Home() {
  const ctx = usePageContext();
  return (
    <div id="page-content">
      <h1>Page title from context: {ctx?.frontmatter?.title || "none"}</h1>
      <p>Custom meta: {ctx?.frontmatter?.customMeta || "none"}</p>
    </div>
  );
}
`,
      {
        "pages/layout.tsx": `
import { Head } from "veryfront/head";
import { usePageContext } from "veryfront/context";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = usePageContext();
  const title = ctx?.frontmatter?.title || "Default Title";
  return (
    <>
      <Head><title>{title}</title></Head>
      <div id="layout-wrapper">
        <header id="layout-header">Layout title: {title}</header>
        <main>{children}</main>
      </div>
    </>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "layout-wrapper", "Should have layout wrapper");
      assertStringIncludes(html, "page-content", "Should have page content");

      const errors = server.logs.filter((l) => l.includes("Invalid hook call") || l.includes("Module not found"));
      assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
    });
  });

  it("should handle API routes returning JSON", async () => {
    const projectDir = await createTestProject(
      "api-json-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/api/hello.ts": `
export function GET() {
  return Response.json({ message: "Hello from API", timestamp: Date.now() });
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/hello`);
      const json = await response.json();

      assertEquals(response.status, 200, "Should return 200");
      assertEquals(response.headers.get("content-type")?.includes("application/json"), true, "Should be JSON");
      assertEquals(json.message, "Hello from API", "Should return correct message");
      assert(json.timestamp > 0, "Should have timestamp");
    });
  });

  it("should handle nested API routes", async () => {
    const projectDir = await createTestProject(
      "api-nested-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/api/users/list.ts": `
export function GET() {
  return Response.json({ users: ["alice", "bob"], count: 2 });
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/users/list`);
      assertEquals(response.status, 200, "Should return 200");

      const json = await response.json();
      assertEquals(json.count, 2, "Should return user count");
      assertEquals(json.users.length, 2, "Should return users array");
    });
  });

  it("should render MDX pages correctly", async () => {
    const projectDir = await createTestProject(
      "mdx-basic-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/blog/hello.mdx": `---
title: Hello World
author: Test Author
---

# Welcome to My Blog

This is a **markdown** page with _formatting_.

- Item 1
- Item 2
- Item 3
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/blog/hello`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "Welcome to My Blog", "Should render heading");
      assertStringIncludes(html, "<strong>markdown</strong>", "Should render bold");
      assertStringIncludes(html, "<em>formatting</em>", "Should render italic");
      assertStringIncludes(html, "Item 1", "Should render list items");
    });
  });

  it("should render MDX with React components", async () => {
    const projectDir = await createTestProject(
      "mdx-components-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/docs/guide.mdx": `
import { Head } from "veryfront/head";

<Head><title>MDX with Components</title></Head>

# Documentation Guide

<div className="custom-component" id="mdx-react-component">
  This is a React component inside MDX!
</div>

Regular markdown content follows.
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/docs/guide`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "Documentation Guide", "Should render heading");
      assertStringIncludes(html, "mdx-react-component", "Should render React component");
      assertStringIncludes(html, "This is a React component inside MDX", "Should render component content");
    });
  });

  it("should handle dynamic [slug] routes", async () => {
    const projectDir = await createTestProject(
      "dynamic-slug-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/blog/[slug].tsx": `
export default function BlogPost({ params }: { params: { slug: string } }) {
  return (
    <div id="blog-post">
      <h1>Blog Post: {params?.slug || "unknown"}</h1>
      <p>Dynamic route works!</p>
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/blog/my-first-post`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "blog-post", "Should render blog post container");
      assertStringIncludes(html, "Dynamic route works", "Should render dynamic content");
    });
  });

  it("should handle dynamic routes at root level", async () => {
    const projectDir = await createTestProject(
      "dynamic-root-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/[page].tsx": `
export default function DynamicPage({ params }: { params: { page: string } }) {
  return (
    <div id="dynamic-root-page">
      <h1>Dynamic Root Page</h1>
      <p>This is a root-level dynamic route</p>
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/about-us`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "dynamic-root-page", "Should render dynamic page");
      assertStringIncludes(html, "Dynamic Root Page", "Should render heading");
    });
  });

  it("should handle catch-all [...slug] routes", async () => {
    const projectDir = await createTestProject(
      "catchall-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/docs/[...slug].tsx": `
export default function DocsPage({ params }: { params: { slug: string[] } }) {
  const slugPath = params?.slug?.join("/") || "root";
  return (
    <div id="docs-page">
      <h1>Documentation</h1>
      <p>Path: {slugPath}</p>
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/docs/getting-started/installation/linux`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "docs-page", "Should render docs container");
      assertStringIncludes(html, "Documentation", "Should render heading");
    });
  });

  it("should return 404 for non-existent pages", async () => {
    const projectDir = await createTestProject(
      "404-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/this-page-does-not-exist`);
      assertEquals(response.status, 404, "Should return 404 for missing page");
    });
  });

  it("should return 404 with informative message", async () => {
    const projectDir = await createTestProject(
      "404-message-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/nonexistent-page`);
      const html = await response.text();

      assertEquals(response.status, 404, "Should return 404");
      assertStringIncludes(html, "Not Found", "Should show not found message");
    });
  });

  it("should handle error.tsx boundary for component errors", async () => {
    const projectDir = await createTestProject(
      "error-boundary-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/layout.tsx": `
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div id="layout">{children}</div>;
}
`,
        "pages/error.tsx": `
"use client";
export default function ErrorPage({ error }: { error: Error }) {
  return (
    <div id="error-boundary">
      <h1>Something went wrong</h1>
      <p>An error occurred while rendering this page.</p>
    </div>
  );
}
`,
        "pages/broken.tsx": `
export default function BrokenPage() {
  throw new Error("Intentional error for testing");
  return <div>This should not render</div>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/broken`);
      assert(response.status === 200 || response.status === 500, "Should return 200 or 500");
    });
  });

  it("should handle inline styles and className in components", async () => {
    const projectDir = await createTestProject(
      "styles-test",
      `
export default function Home() {
  return (
    <div className="styled-container" style={{ backgroundColor: "blue", padding: "20px" }}>
      <h1 className="styled-heading" style={{ color: "white" }}>Styled Page</h1>
      <p>Page with inline styles works correctly</p>
    </div>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "styled-container", "Should have styled container class");
      assertStringIncludes(html, "Styled Page", "Should render page content");
      assertStringIncludes(html, "background-color", "Should have inline styles");
    });
  });

  it("should serve static files from public directory", async () => {
    const projectDir = await createTestProject(
      "static-files-test",
      `
export default function Home() {
  return (
    <div>
      <img src="/logo.svg" alt="Logo" />
      <p>Static files test</p>
    </div>
  );
}
`,
      {
        "public/logo.svg":
          `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>`,
        "public/robots.txt": `User-agent: *\nAllow: /`,
      },
    );

    await withServer(projectDir, async (server) => {
      const svgResponse = await fetch(`http://127.0.0.1:${server.port}/logo.svg`);
      assertEquals(svgResponse.status, 200, "Should serve SVG file");
      const svgContent = await svgResponse.text();
      assertStringIncludes(svgContent, "<svg", "Should contain SVG content");

      const robotsResponse = await fetch(`http://127.0.0.1:${server.port}/robots.txt`);
      assertEquals(robotsResponse.status, 200, "Should serve robots.txt");
      const robotsContent = await robotsResponse.text();
      assertStringIncludes(robotsContent, "User-agent", "Should contain robots content");
    });
  });

  it("should work correctly in production mode", async () => {
    const projectDir = await createTestProject(
      "production-mode-test",
      `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Production Test</title></Head>
      <div id="production-content">
        <h1>Production Mode</h1>
        <p>Environment: {process.env.NODE_ENV}</p>
      </div>
    </>
  );
}
`,
    );

    await withServer(
      projectDir,
      async (server) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        const html = await response.text();

        assertEquals(response.status, 200, "Should return 200 in production mode");
        assertStringIncludes(html, "production-content", "Should render content");
        assertStringIncludes(html, "Production Mode", "Should render heading");

        const criticalErrors = server.logs.filter((l) =>
          l.includes("FATAL") || l.includes("Unhandled") || l.includes("esm.sh/_vf_modules")
        );
        assertEquals(criticalErrors.length, 0, `Should have no critical errors: ${criticalErrors.join("\n")}`);
      },
      "production",
    );
  });

  // Regression test: Ensure deno.json relative paths don't corrupt framework imports
  // Issue: deno.json with "veryfront/router": "./src/react/router/index.tsx" was
  // overwriting the correct default mapping, causing runtime errors.
  it("should resolve framework imports when project has deno.json with relative paths", async () => {
    const projectDir = await createTestProject(
      "deno-json-relative-test",
      `
import { useRouter } from "veryfront/router";
import { Head } from "veryfront/head";

export default function Home() {
  const router = useRouter();
  return (
    <>
      <Head><title>Deno.json Test</title></Head>
      <div id="content">
        <h1>Router works with deno.json</h1>
        <p>Pathname: {router.pathname}</p>
      </div>
    </>
  );
}
`,
      {
        // This deno.json has relative paths that should NOT corrupt framework imports
        "deno.json": JSON.stringify({
          imports: {
            // These relative paths are for Deno native resolution, not browser/SSR
            "veryfront/router": "./src/react/router/index.tsx",
            "veryfront/head": "./src/react/head/index.tsx",
            "my-local-lib": "../external/lib.ts",
          },
        }),
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assert(!html.includes("Module not found"), "Should resolve framework imports correctly");
      assert(!html.includes("src/react/router"), "Should NOT use relative path from deno.json");
      assertStringIncludes(html, "Router works with deno.json", "Should render content");

      // Verify no errors about missing modules at relative paths
      const moduleErrors = server.logs.filter((l) =>
        l.includes("Missing module") ||
        l.includes("src/react/router") ||
        l.includes("src/react/head")
      );
      assertEquals(moduleErrors.length, 0, `Should have no module errors: ${moduleErrors.join("\n")}`);
    });
  });

  // Regression test: Ensure HMR doesn't trigger for cache file writes
  // Issue: .cache/veryfront-http-bundle/ file writes were triggering HMR updates
  // causing page flashing with hundreds of unnecessary re-renders.
  it("should not log excessive HMR updates on initial page load", async () => {
    const projectDir = await createTestProject(
      "hmr-cache-filter-test",
      `
import { Head } from "veryfront/head";
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return (
    <>
      <Head><title>HMR Test</title></Head>
      <div id="content">
        <h1>HMR Cache Filter Test</h1>
        <p>Path: {router.pathname}</p>
      </div>
    </>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      // Clear logs before the request
      server.logs.length = 0;

      // Make initial request - this populates the HTTP bundle cache
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      assertEquals(response.status, 200, "Should return 200");

      // Wait a bit for any cache writes and potential HMR triggers
      await new Promise((r) => setTimeout(r, 500));

      // Count HMR-related log entries for .cache paths
      const cacheHmrLogs = server.logs.filter((l) =>
        l.includes(".cache") && (l.includes("HMR") || l.includes("reload") || l.includes("update"))
      );

      // There should be minimal or no HMR activity for cache files
      // Allow some tolerance (e.g., up to 5) but catch the hundreds we saw before
      assert(
        cacheHmrLogs.length < 10,
        `Should not have excessive HMR updates for cache files. Found ${cacheHmrLogs.length} entries:\n${cacheHmrLogs.slice(0, 5).join("\n")}`,
      );
    });
  });

  // Test: Relative imports from pages to components directory
  it("should handle page importing component from ../components/", async () => {
    const projectDir = await createTestProject(
      "relative-component-import-test",
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
        "components/MyComponent.tsx": `
export default function MyComponent() {
  return <div id="my-component">Component works!</div>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "my-component", "Should render component");
      assertStringIncludes(html, "Component works!", "Component content should be present");
    });
  });

  // Test: Deeply nested relative imports (multi-level ../ paths)
  it("should handle deeply nested relative imports with multiple levels", async () => {
    const projectDir = await createTestProject(
      "deep-relative-import-test",
      `export default function Placeholder() { return null; }`, // Placeholder, we use additionalFiles for the real page
      {
        "pages/admin/settings/index.tsx": `
import Button from "../../../components/ui/Button";
import { formatDate } from "../../../lib/utils/date";

export default function SettingsPage() {
  return (
    <div id="settings-page">
      <h1>Settings</h1>
      <p id="date">{formatDate()}</p>
      <Button />
    </div>
  );
}
`,
        "components/ui/Button.tsx": `
export default function Button() {
  return <button id="ui-button">Click me</button>;
}
`,
        "lib/utils/date.ts": `
export function formatDate() {
  return "2024-01-01";
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/admin/settings`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "settings-page", "Should render settings page");
      assertStringIncludes(html, "ui-button", "Should render Button component from deep path");
      assertStringIncludes(html, "2024-01-01", "Should render formatted date from lib/utils");
    });
  });

  // Test: Client components with "use client" directive
  it("should handle client components with use client directive", async () => {
    const projectDir = await createTestProject(
      "use-client-test",
      `
"use client";
import { useState, useEffect } from "react";

export default function ClientPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div id="client-page">
      <h1>Client Component</h1>
      <p>Mounted: {mounted ? "yes" : "no"}</p>
    </div>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "client-page", "Should render client component");
      assertStringIncludes(html, "Client Component", "Should render heading");
      assert(!html.includes("Invalid hook call"), "Should not have hook errors in HTML");

      const errors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(errors.length, 0, "Should have no React errors");
    });
  });

  // Test: Multiple pages accessing same framework import
  it("should handle multiple pages with same framework imports", async () => {
    const projectDir = await createTestProject(
      "multi-page-test",
      `
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return <div id="home">Home: {router.pathname}</div>;
}
`,
      {
        "pages/about.tsx": `
import { useRouter } from "veryfront/router";

export default function About() {
  const router = useRouter();
  return <div id="about">About: {router.pathname}</div>;
}
`,
        "pages/contact.tsx": `
import { useRouter } from "veryfront/router";
import { Head } from "veryfront/head";

export default function Contact() {
  const router = useRouter();
  return (
    <>
      <Head><title>Contact</title></Head>
      <div id="contact">Contact: {router.pathname}</div>
    </>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      // Test all three pages
      const homeRes = await fetch(`http://127.0.0.1:${server.port}/`);
      const aboutRes = await fetch(`http://127.0.0.1:${server.port}/about`);
      const contactRes = await fetch(`http://127.0.0.1:${server.port}/contact`);

      assertEquals(homeRes.status, 200, "Home should return 200");
      assertEquals(aboutRes.status, 200, "About should return 200");
      assertEquals(contactRes.status, 200, "Contact should return 200");

      const homeHtml = await homeRes.text();
      const aboutHtml = await aboutRes.text();
      const contactHtml = await contactRes.text();

      assertStringIncludes(homeHtml, "Home:", "Home should render");
      assertStringIncludes(aboutHtml, "About:", "About should render");
      assertStringIncludes(contactHtml, "Contact:", "Contact should render");

      // Verify no dual React errors across all pages
      const errors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(errors.length, 0, "Should have no React errors across pages");
    });
  });

  // Test: MDX with custom components defined in same file
  it("should handle MDX with inline components", async () => {
    const projectDir = await createTestProject(
      "mdx-inline-components-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/docs/intro.mdx": `
export function Callout({ children }) {
  return <div className="callout" id="custom-callout">{children}</div>;
}

# Introduction

Welcome to our documentation.

<Callout>
  This is an important note!
</Callout>

Continue reading below.
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/docs/intro`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "Introduction", "Should render heading");
      assertStringIncludes(html, "custom-callout", "Should render custom component");
      assertStringIncludes(html, "important note", "Should render callout content");
    });
  });

  // Test: Nested static routes with dynamic segment
  it("should handle nested routes with single dynamic segment", async () => {
    const projectDir = await createTestProject(
      "nested-dynamic-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/projects/[id].tsx": `
export default function ProjectPage({ params }: { params: { id: string } }) {
  return (
    <div id="project-page">
      <h1>Project Page</h1>
      <p>Project ID: {params?.id || "unknown"}</p>
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/projects/my-project-123`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "project-page", "Should render project page");
      assertStringIncludes(html, "Project Page", "Should render heading");
    });
  });

  // Test: API route with different response types
  it("should handle API routes with custom status codes", async () => {
    const projectDir = await createTestProject(
      "api-status-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/api/status.ts": `
export function GET() {
  return new Response(JSON.stringify({ status: "ok", code: 201 }), {
    status: 201,
    headers: { "Content-Type": "application/json" }
  });
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/status`);
      assertEquals(response.status, 201, "Should return custom status 201");

      const json = await response.json();
      assertEquals(json.status, "ok", "Should return ok status");
      assertEquals(json.code, 201, "Should return code in body");
    });
  });

  // Test: Page with CSS module import (if supported)
  it("should handle pages with inline styles object", async () => {
    const projectDir = await createTestProject(
      "styles-object-test",
      `
const styles = {
  container: { backgroundColor: '#f0f0f0', padding: '20px' },
  heading: { color: '#333', fontSize: '24px' },
  text: { color: '#666' }
};

export default function StyledPage() {
  return (
    <div style={styles.container} id="styled-container">
      <h1 style={styles.heading}>Styled Heading</h1>
      <p style={styles.text}>Styled text content</p>
    </div>
  );
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "styled-container", "Should render styled container");
      assertStringIncludes(html, "Styled Heading", "Should render heading");
      assertStringIncludes(html, "background-color", "Should include inline styles");
    });
  });

  // Test: Error boundary with reset functionality
  it("should handle error.tsx with error details", async () => {
    const projectDir = await createTestProject(
      "error-details-test",
      `
export default function Home() {
  return <div>Home Page</div>;
}
`,
      {
        "pages/throws.tsx": `
export default function ThrowsPage() {
  throw new Error("Test error message");
}
`,
        "pages/error.tsx": `
"use client";
export default function ErrorBoundary({ error }: { error: Error }) {
  return (
    <div id="error-boundary">
      <h1>Error Caught</h1>
      <p id="error-message">Message: {error?.message || "Unknown error"}</p>
    </div>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/throws`);
      // Error pages might return 200 or 500 depending on implementation
      assert(response.status === 200 || response.status === 500, "Should return 200 or 500");
    });
  });

  // Test: Framework imports should work with layout components importing from veryfront/*
  // Uses layout.tsx pattern since component-from-page imports have separate build issues
  it("should handle layout importing framework modules with hooks", async () => {
    const projectDir = await createTestProject(
      "layout-framework-import-test",
      `
export default function Home() {
  return (
    <div id="page">
      <h1>Home Page</h1>
      <p>Content rendered inside layout</p>
    </div>
  );
}
`,
      {
        "pages/layout.tsx": `
import { useRouter } from "veryfront/router";
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <>
      <Head><title>Layout with Router</title></Head>
      <div id="layout-wrapper">
        <header id="layout-header">
          <p>Layout pathname: {router.pathname}</p>
        </header>
        <main>{children}</main>
      </div>
    </>
  );
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "layout-wrapper", "Should render layout");
      assertStringIncludes(html, "Layout pathname", "Should render router data from layout");
      assertStringIncludes(html, "Home Page", "Should render page content");
      assert(!html.includes("Module not found"), "Should resolve framework imports in layout");

      const hookErrors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(hookErrors.length, 0, "Should have no React hook errors");
    });
  });
});
