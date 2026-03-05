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
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { load as loadEnv } from "#veryfront/platform/compat/std/dotenv.ts";

// Load .env file for test configuration (VERYFRONT_BINARY_FRESH, etc.)
try {
  await loadEnv({ export: true, allowEmptyValues: true, examplePath: null });
} catch {
  // .env file doesn't exist - that's fine
}

// Use a unique binary path per test run to prevent race conditions when multiple
// test suites run concurrently (e.g., deno task test picking up this file)
const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? `/tmp/veryfront-e2e-bin-${Deno.pid}`;
const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;
/** Get an available port using OS-assigned port 0. */
async function getAvailablePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

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

  // Run the same pre-build pipeline used by distribution builds
  console.log("📦 Preparing build artifacts...");
  const prepareResult = await new Deno.Command("deno", {
    args: ["task", "build:prepare"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!prepareResult.success) throw new Error("Failed to prepare build artifacts");

  console.log("📦 Compiling binary...");
  const result = await new Deno.Command("deno", {
    args: [
      "compile",
      "--allow-all",
      "--include",
      "src/platform/polyfills",
      "--include",
      "src/proxy/main.ts",
      "--include",
      "dist/framework-src",
      "--output",
      BINARY_PATH,
      "cli/main.ts",
    ],
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

async function waitForServer(port: number, deadlineMs = 60_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`);
      // Consume the response body to avoid connection issues
      await resp.text();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server failed to start on port ${port}`);
}

async function startBinaryServer(
  projectDir: string,
  nodeEnv = "development",
  extraEnv?: Record<string, string>,
): Promise<TestServer> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const logs: string[] = [];
    const port = await getAvailablePort();
    const cacheDir = await Deno.makeTempDir({
      prefix: nodeEnv === "production" ? "vf-cache-prod-" : "vf-cache-",
    });

    const process = new Deno.Command(BINARY_PATH, {
      args: ["serve", "--mode=production", "-p", String(port)],
      cwd: projectDir,
      env: {
        ...Deno.env.toObject(),
        NODE_ENV: nodeEnv,
        LOG_FORMAT: "text",
        VERYFRONT_CACHE_DIR: cacheDir,
        ...extraEnv,
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
        await process.status;
      } catch {
        // already dead
      }

      // Retry on port collision
      const logOutput = logs.join("\n");
      if (attempt < maxRetries - 1 && logOutput.includes("already in use")) {
        try {
          await Deno.remove(cacheDir, { recursive: true });
        } catch { /* ignore */ }
        continue;
      }

      throw new Error(
        `Server failed to start on port ${port} within 60s. Logs:\n${logOutput.slice(-3000)}`,
      );
    }

    // Give the server a moment to stabilize after first request
    await new Promise((r) => setTimeout(r, 500));

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
        await new Promise((r) => setTimeout(r, 500)); // Port release time (increased for CI)
        try {
          await Deno.remove(cacheDir, { recursive: true });
        } catch {
          // ignore
        }
      },
    };
  }

  throw new Error("Failed to start server after all retries");
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

  await Deno.writeTextFile(
    join(projectDir, "veryfront.config.ts"),
    `export default { fs: { type: "local" } };`,
  );

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

async function withServer(
  projectDir: string,
  fn: (server: TestServer) => Promise<void>,
  nodeEnv?: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  const server = await startBinaryServer(projectDir, nodeEnv, extraEnv);
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

  afterAll(async () => {
    // Clean up the test binary after all tests complete
    try {
      await Deno.remove(BINARY_PATH);
      await Deno.remove(BINARY_HASH_PATH);
    } catch {
      // Ignore errors - binary may not exist or may already be cleaned up
    }
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
        l.includes("esm.sh/_vf_modules") || l.includes("dual React") ||
        l.includes("Invalid hook call")
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

      const cacheErrors = server.logs.filter((l) =>
        l.includes("file://") && l.includes("not found")
      );
      assertEquals(
        cacheErrors.length,
        0,
        `Should have no cache path errors: ${cacheErrors.join("\n")}`,
      );
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

      const errors = server.logs.filter((l) =>
        l.includes("Invalid hook call") || l.includes("Module not found")
      );
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
      assertEquals(
        response.headers.get("content-type")?.includes("application/json"),
        true,
        "Should be JSON",
      );
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
      assertStringIncludes(
        html,
        "This is a React component inside MDX",
        "Should render component content",
      );
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
      const response = await fetch(
        `http://127.0.0.1:${server.port}/docs/getting-started/installation/linux`,
      );
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
        assertEquals(
          criticalErrors.length,
          0,
          `Should have no critical errors: ${criticalErrors.join("\n")}`,
        );
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
      // The filter checks for patterns indicating the relative path from deno.json
      // is being used instead of the framework path. Note: "framework-src/react/router"
      // in debug logs is fine - we're looking for "./src/react/router" errors.
      const moduleErrors = server.logs.filter((l) =>
        l.includes("Missing module") ||
        l.includes("./src/react/router") ||
        l.includes("./src/react/head") ||
        l.includes("Could not resolve ./src") ||
        (l.includes("error") && l.toLowerCase().includes("src/react/router") &&
          !l.includes("framework-src"))
      );
      assertEquals(
        moduleErrors.length,
        0,
        `Should have no module errors: ${moduleErrors.join("\n")}`,
      );
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
        `Should not have excessive HMR updates for cache files. Found ${cacheHmrLogs.length} entries:\n${
          cacheHmrLogs.slice(0, 5).join("\n")
        }`,
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

  // Test: Same-directory relative imports (./)
  it("should handle same-directory relative imports with ./", async () => {
    const projectDir = await createTestProject(
      "same-dir-import-test",
      `export default function Placeholder() { return null; }`,
      {
        "pages/dashboard/index.tsx": `
import { DashboardHeader } from "./header";
import { DashboardStats } from "./stats";

export default function Dashboard() {
  return (
    <div id="dashboard">
      <DashboardHeader />
      <DashboardStats />
    </div>
  );
}
`,
        "pages/dashboard/header.tsx": `
export function DashboardHeader() {
  return <h1 id="dashboard-header">Dashboard</h1>;
}
`,
        "pages/dashboard/stats.tsx": `
export function DashboardStats() {
  return <div id="dashboard-stats">Stats: 42</div>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "dashboard-header", "Should render header from same directory");
      assertStringIncludes(html, "dashboard-stats", "Should render stats from same directory");
    });
  });

  // Test: Mixed relative and @/ alias imports in same file
  it("should handle mixed relative and @/ alias imports", async () => {
    const projectDir = await createTestProject(
      "mixed-import-test",
      `
import { Button } from "@/components/Button";
import { helper } from "../lib/helper";

export default function MixedPage() {
  return (
    <div id="mixed-page">
      <Button />
      <p id="helper-result">{helper()}</p>
    </div>
  );
}
`,
      {
        "components/Button.tsx": `
export function Button() {
  return <button id="alias-button">Alias Button</button>;
}
`,
        "lib/helper.ts": `
export function helper() {
  return "helper-works";
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "alias-button", "Should render @/ aliased component");
      assertStringIncludes(html, "helper-works", "Should render relative imported helper");
    });
  });

  // Test: Chained relative imports (component imports another component)
  it("should handle chained relative imports between components", async () => {
    const projectDir = await createTestProject(
      "chained-import-test",
      `
import { Card } from "../components/Card";

export default function CardPage() {
  return (
    <div id="card-page">
      <Card title="Test Card" />
    </div>
  );
}
`,
      {
        "components/Card.tsx": `
import { CardHeader } from "./CardHeader";
import { CardBody } from "./CardBody";

export function Card({ title }: { title: string }) {
  return (
    <div id="card">
      <CardHeader title={title} />
      <CardBody />
    </div>
  );
}
`,
        "components/CardHeader.tsx": `
export function CardHeader({ title }: { title: string }) {
  return <h2 id="card-header">{title}</h2>;
}
`,
        "components/CardBody.tsx": `
export function CardBody() {
  return <div id="card-body">Card content here</div>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "card-header", "Should render chained CardHeader");
      assertStringIncludes(html, "card-body", "Should render chained CardBody");
      assertStringIncludes(html, "Test Card", "Should pass props through chain");
    });
  });

  // Test: Index file resolution (import directory resolves to index.ts)
  it("should resolve directory imports to index files", async () => {
    const projectDir = await createTestProject(
      "index-resolution-test",
      `
import { utils } from "../lib/utils";
import { Button } from "../components/ui";

export default function IndexPage() {
  return (
    <div id="index-page">
      <p id="utils-result">{utils.format("test")}</p>
      <Button />
    </div>
  );
}
`,
      {
        "lib/utils/index.ts": `
export const utils = {
  format: (str: string) => \`formatted-\${str}\`,
};
`,
        "components/ui/index.tsx": `
export { Button } from "./Button";
`,
        "components/ui/Button.tsx": `
export function Button() {
  return <button id="index-button">Index Button</button>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "formatted-test", "Should resolve lib/utils to index.ts");
      assertStringIncludes(html, "index-button", "Should resolve components/ui to index.tsx");
    });
  });

  // Test: Re-exports (export * from)
  it("should handle re-exports with export * from", async () => {
    const projectDir = await createTestProject(
      "reexport-test",
      `
import { add, multiply, PI } from "../lib/math";

export default function MathPage() {
  return (
    <div id="math-page">
      <p id="add-result">{add(2, 3)}</p>
      <p id="multiply-result">{multiply(4, 5)}</p>
      <p id="pi-result">{PI}</p>
    </div>
  );
}
`,
      {
        "lib/math/index.ts": `
export * from "./operations";
export * from "./constants";
`,
        "lib/math/operations.ts": `
export function add(a: number, b: number) { return a + b; }
export function multiply(a: number, b: number) { return a * b; }
`,
        "lib/math/constants.ts": `
export const PI = 3.14159;
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, ">5<", "Should have add(2,3) = 5");
      assertStringIncludes(html, ">20<", "Should have multiply(4,5) = 20");
      assertStringIncludes(html, "3.14159", "Should have PI constant");
    });
  });

  // Test: Layout with relative imports
  it("should handle layout files with relative imports", async () => {
    const projectDir = await createTestProject(
      "layout-relative-import-test",
      `
export default function LayoutTestPage() {
  return <div id="layout-test-content">Page Content</div>;
}
`,
      {
        "pages/layout.tsx": `
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="layout-wrapper">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
`,
        "components/Header.tsx": `
export function Header() {
  return <header id="layout-header">Site Header</header>;
}
`,
        "components/Footer.tsx": `
export function Footer() {
  return <footer id="layout-footer">Site Footer</footer>;
}
`,
      },
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(
        html,
        "layout-header",
        "Should render Header from layout's relative import",
      );
      assertStringIncludes(
        html,
        "layout-footer",
        "Should render Footer from layout's relative import",
      );
      assertStringIncludes(html, "layout-test-content", "Should render page content");
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

  // Test: app provider defined in veryfront.config.ts instead of file convention
  // Regression test: User reported bug when using config-based app/layout providers
  it("should render app provider defined in veryfront.config.ts", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-config-app-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-config-app",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    // Config-based app provider (NOT using file convention)
    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  app: "lib/providers/CustomApp.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "lib/providers"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "lib/providers/CustomApp.tsx"),
      `
export default function CustomApp({ children }: { children: React.ReactNode }) {
  return (
    <div id="config-app-wrapper" data-testid="config-app">
      <header id="config-app-header">Config App Header</header>
      {children}
    </div>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Home page with config app</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(
        html,
        "config-app-wrapper",
        "Should have app wrapper from config-based provider",
      );
      assertStringIncludes(html, "Config App Header", "Should render config app header");
      assertStringIncludes(html, "Home page with config app", "Should render page content");

      const errors = server.logs.filter((l) =>
        l.includes("Invalid hook call") ||
        l.includes("Module not found") ||
        l.includes("Cannot find") ||
        l.includes("app provider")
      );
      assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
    });
  });

  // Test: layout defined in veryfront.config.ts instead of file convention
  it("should render layout defined in veryfront.config.ts", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-config-wrap-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-config-layout",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    // Config-based layout (NOT using file convention pages/layout.tsx)
    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "lib/layouts/MainLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "lib/layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "lib/layouts/MainLayout.tsx"),
      `
import { Head } from "veryfront/head";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Config Layout Test</title></Head>
      <div id="config-layout-wrapper">
        <header id="config-layout-header">Config Layout Header</header>
        <main id="config-layout-main">{children}</main>
        <footer id="config-layout-footer">Config Layout Footer</footer>
      </div>
    </>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Home page with config layout</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "config-layout-wrapper", "Should have layout wrapper from config");
      assertStringIncludes(html, "Config Layout Header", "Should render config layout header");
      assertStringIncludes(html, "Config Layout Footer", "Should render config layout footer");
      assertStringIncludes(
        html,
        "Home page with config layout",
        "Should render page content inside layout",
      );

      // Filter for actual errors, not debug-level layout discovery logs
      // Debug logs use '·' indicator, errors use '✖'
      const errors = server.logs.filter((l) =>
        !l.includes("Silent failure") &&
        !l.includes("stat layout candidate failed") &&
        !l.includes("stat nested tsx/jsx layout failed") &&
        (l.includes("Invalid hook call") ||
          l.includes("Module not found") ||
          l.includes("Cannot find") ||
          (l.includes("layout") && l.includes("failed") && !l.includes(" · ")))
      );
      assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
    });
  });

  // Test: both app AND layout defined in veryfront.config.ts
  it("should render both app and layout defined in veryfront.config.ts", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-config-both-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-config-both",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    // Both app and layout defined in config
    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  app: "lib/AppProvider.tsx",
  layout: "lib/RootLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "lib"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "lib/AppProvider.tsx"),
      `
export default function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <div id="config-app-root" data-provider="app">
      <div id="app-banner">App Provider Banner</div>
      {children}
    </div>
  );
}
`,
    );

    await Deno.writeTextFile(
      join(projectDir, "lib/RootLayout.tsx"),
      `
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Config App + Layout</title></Head>
      <div id="config-layout-container">
        <header id="layout-header">Layout Header</header>
        <main>{children}</main>
      </div>
    </>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Page with config app and layout</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "config-app-root", "Should have app wrapper from config");
      assertStringIncludes(html, "App Provider Banner", "Should render app banner");
      assertStringIncludes(
        html,
        "config-layout-container",
        "Should have layout container from config",
      );
      assertStringIncludes(html, "Layout Header", "Should render layout header");
      assertStringIncludes(html, "Page with config app and layout", "Should render page content");

      const errors = server.logs.filter((l) =>
        l.includes("Invalid hook call") ||
        l.includes("Module not found") ||
        l.includes("Cannot find")
      );
      assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
    });
  });

  // Test: config-based layout with useRouter hook (test framework imports work in config layouts)
  it("should handle config layout with framework hooks", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-config-layout-hooks-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-config-layout-hooks",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "layouts/HooksLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "layouts/HooksLayout.tsx"),
      `
import { useRouter } from "veryfront/router";
import { Head } from "veryfront/head";
import { usePageContext } from "veryfront/context";

export default function HooksLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ctx = usePageContext();

  return (
    <>
      <Head><title>Hooks Layout</title></Head>
      <div id="hooks-layout">
        <nav id="hooks-nav">
          <span id="pathname">Path: {router.pathname}</span>
        </nav>
        <main>{children}</main>
      </div>
    </>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Home with hooks layout</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(html, "hooks-layout", "Should render hooks layout");
      assertStringIncludes(html, "hooks-nav", "Should render nav");
      assertStringIncludes(html, "Home with hooks layout", "Should render page content");

      const hookErrors = server.logs.filter((l) =>
        l.includes("Invalid hook call") ||
        l.includes("more than one copy of React") ||
        l.includes("Module not found")
      );
      assertEquals(
        hookErrors.length,
        0,
        `Should have no hook/module errors: ${hookErrors.join("\n")}`,
      );
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

  // Test: Layout at components/layouts/ path via config (mimics codersociety production setup)
  // Regression test: layout at components/layouts/DefaultLayout.tsx was not found due to
  // path normalization double-stripping in getEntityInfo (components/ prefix matched, then
  // layouts/ prefix matched again, corrupting the path).
  it("should render layout from components/layouts/ via config", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-components-layouts-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-components-layouts",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "components/layouts/DefaultLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "components/layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "components/layouts/DefaultLayout.tsx"),
      `
import { Head } from "veryfront/head";

export default function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Components Layout Test</title></Head>
      <div id="components-layout-wrapper">
        <header id="components-layout-header">Components Layout Header</header>
        <main id="components-layout-main">{children}</main>
        <footer id="components-layout-footer">Components Layout Footer</footer>
      </div>
    </>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Page with components/layouts layout</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(
        html,
        "components-layout-wrapper",
        "Should have layout wrapper from components/layouts/",
      );
      assertStringIncludes(
        html,
        "Components Layout Header",
        "Should render layout header",
      );
      assertStringIncludes(
        html,
        "Components Layout Footer",
        "Should render layout footer",
      );
      assertStringIncludes(
        html,
        "Page with components/layouts layout",
        "Should render page content inside layout",
      );

      // Filter for actual errors, not debug-level layout discovery logs
      // Debug logs use '·' indicator, errors use '✖'
      const errors = server.logs.filter((l) =>
        !l.includes("Silent failure") &&
        !l.includes("stat layout candidate failed") &&
        !l.includes("stat nested tsx/jsx layout failed") &&
        (l.includes("not found") ||
          l.includes("Module not found") ||
          l.includes("Cannot find") ||
          (l.includes("layout") && l.includes("failed") && !l.includes(" · ")))
      );
      assertEquals(errors.length, 0, `Should have no layout errors: ${errors.join("\n")}`);
    });
  });

  // Test: Layout rendering in production mode
  // Regression test: split mode uses NODE_ENV=production and layout must still render
  it("should render layout correctly in production mode", async () => {
    const projectDir = await createTestProject(
      "layout-production-test",
      `
export default function Home() {
  return <div id="page-content">Production page content</div>;
}
`,
      {
        "pages/layout.tsx": `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="prod-layout-wrapper">
      <header id="prod-layout-header">Production Layout Header</header>
      <main>{children}</main>
      <footer id="prod-layout-footer">Production Layout Footer</footer>
    </div>
  );
}
`,
      },
    );

    await withServer(
      projectDir,
      async (server) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        const html = await response.text();

        assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
        assertStringIncludes(
          html,
          "prod-layout-wrapper",
          "Should have layout wrapper in production",
        );
        assertStringIncludes(html, "Production Layout Header", "Should render layout header");
        assertStringIncludes(html, "Production Layout Footer", "Should render layout footer");
        assertStringIncludes(html, "Production page content", "Should render page content");

        const criticalErrors = server.logs.filter((l) =>
          l.includes("FATAL") || l.includes("Unhandled") || l.includes("Invalid hook call")
        );
        assertEquals(
          criticalErrors.length,
          0,
          `Should have no critical errors: ${criticalErrors.join("\n")}`,
        );
      },
      "production",
    );
  });

  // Test: Config-based layout in production mode (closest to split:binary setup)
  // Regression test: In split:binary mode (production + config layout), the layout was not
  // rendered because config loading or layout resolution failed silently.
  it("should render config layout in production mode", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-config-layout-prod-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-config-layout-prod",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "components/layouts/MainLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "components/layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "components/layouts/MainLayout.tsx"),
      `
import { Head } from "veryfront/head";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Config Layout Production</title></Head>
      <div id="config-prod-layout">
        <nav id="config-prod-nav">Navigation Bar</nav>
        <main id="config-prod-main">{children}</main>
        <footer id="config-prod-footer">Footer Content</footer>
      </div>
    </>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Config layout in production</div>;
}
`,
    );

    await withServer(
      projectDir,
      async (server) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        const html = await response.text();

        assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
        assertStringIncludes(html, "config-prod-layout", "Should have config layout in production");
        assertStringIncludes(html, "Navigation Bar", "Should render nav from config layout");
        assertStringIncludes(html, "Footer Content", "Should render footer from config layout");
        assertStringIncludes(
          html,
          "Config layout in production",
          "Should render page content inside config layout",
        );

        // Filter for actual errors, not debug-level layout discovery logs
        // Debug logs use '·' indicator, errors use '✖'
        const errors = server.logs.filter((l) =>
          !l.includes("Silent failure") &&
          !l.includes("stat layout candidate failed") &&
          !l.includes("stat nested tsx/jsx layout failed") &&
          (l.includes("not found") ||
            l.includes("Module not found") ||
            l.includes("FATAL") ||
            (l.includes("layout") && l.includes("failed") && !l.includes(" · ")))
        );
        assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
      },
      "production",
    );
  });

  // Test: MDX layout at components/layouts/ path via config
  // Tests the exact codersociety pattern: config layout using .mdx file in components/layouts/
  it("should render MDX layout from components/layouts/ via config", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-mdx-components-layout-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-mdx-components-layout",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "components/layouts/DefaultLayout.mdx"
};`,
    );

    await Deno.mkdir(join(projectDir, "components/layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "components/layouts/DefaultLayout.mdx"),
      `---
isLayout: true
---

<div id="mdx-layout-wrapper">
  <header id="mdx-layout-header">MDX Layout Header</header>
  <main>{props.children}</main>
  <footer id="mdx-layout-footer">MDX Layout Footer</footer>
</div>
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Page inside MDX layout</div>;
}
`,
    );

    await withServer(projectDir, async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
      assertStringIncludes(
        html,
        "mdx-layout-wrapper",
        "Should have MDX layout wrapper",
      );
      assertStringIncludes(html, "MDX Layout Header", "Should render MDX layout header");
      assertStringIncludes(html, "MDX Layout Footer", "Should render MDX layout footer");
      assertStringIncludes(
        html,
        "Page inside MDX layout",
        "Should render page content inside MDX layout",
      );
    });
  });

  // Test: Layout with nested page routes in production mode
  // Ensures layout wraps all pages, not just index, in production
  it("should render layout for nested routes in production mode", async () => {
    const projectDir = await createTestProject(
      "layout-nested-routes-prod-test",
      `
export default function Home() {
  return <div id="home-content">Home Page</div>;
}
`,
      {
        "pages/layout.tsx": `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="nested-prod-layout">
      <header id="nested-prod-header">Nested Production Header</header>
      <main>{children}</main>
    </div>
  );
}
`,
        "pages/about.tsx": `
export default function About() {
  return <div id="about-content">About Page Content</div>;
}
`,
        "pages/blog/index.tsx": `
export default function Blog() {
  return <div id="blog-content">Blog Page Content</div>;
}
`,
      },
    );

    await withServer(
      projectDir,
      async (server) => {
        // Test index page
        const homeRes = await fetch(`http://127.0.0.1:${server.port}/`);
        const homeHtml = await homeRes.text();
        assertEquals(homeRes.status, 200);
        assertStringIncludes(homeHtml, "nested-prod-layout", "Home should have layout");
        assertStringIncludes(
          homeHtml,
          "Nested Production Header",
          "Home should have layout header",
        );
        assertStringIncludes(homeHtml, "Home Page", "Home should render content");

        // Test about page
        const aboutRes = await fetch(`http://127.0.0.1:${server.port}/about`);
        const aboutHtml = await aboutRes.text();
        assertEquals(aboutRes.status, 200);
        assertStringIncludes(aboutHtml, "nested-prod-layout", "About should have layout");
        assertStringIncludes(aboutHtml, "About Page Content", "About should render content");

        // Test blog page
        const blogRes = await fetch(`http://127.0.0.1:${server.port}/blog`);
        const blogHtml = await blogRes.text();
        assertEquals(blogRes.status, 200);
        assertStringIncludes(blogHtml, "nested-prod-layout", "Blog should have layout");
        assertStringIncludes(blogHtml, "Blog Page Content", "Blog should render content");
      },
      "production",
    );
  });

  // Test: Layout rendering with PROXY_MODE=1 (simulates split mode production server)
  // Regression test: In split:binary mode, the production server runs with PROXY_MODE=1.
  // Without proxy headers, it should fall back to local config and still render layouts.
  it("should render layout when PROXY_MODE=1 without proxy headers", async () => {
    const projectDir = await createTestProject(
      "proxy-mode-layout-test",
      `
export default function Home() {
  return <div id="page-content">Proxy mode page content</div>;
}
`,
      {
        "pages/layout.tsx": `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="proxy-layout-wrapper">
      <header id="proxy-layout-header">Proxy Mode Layout Header</header>
      <main>{children}</main>
      <footer id="proxy-layout-footer">Proxy Mode Layout Footer</footer>
    </div>
  );
}
`,
      },
    );

    await withServer(
      projectDir,
      async (server) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        const html = await response.text();

        assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
        assertStringIncludes(
          html,
          "proxy-layout-wrapper",
          "Should have layout wrapper in proxy mode",
        );
        assertStringIncludes(
          html,
          "Proxy Mode Layout Header",
          "Should render layout header in proxy mode",
        );
        assertStringIncludes(
          html,
          "Proxy Mode Layout Footer",
          "Should render layout footer in proxy mode",
        );
        assertStringIncludes(
          html,
          "Proxy mode page content",
          "Should render page content in proxy mode",
        );
      },
      "production",
      // Clear API env vars to test pure local filesystem fallback
      {
        PROXY_MODE: "1",
        PRODUCTION_MODE: "1",
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_API_TOKEN: "",
      },
    );
  });

  // Test: Config layout with PROXY_MODE=1 and components/layouts/ path
  // Regression test: In split:binary mode, the production server gets PROXY_MODE=1 and must resolve
  // config-based layout paths through the API adapter. Without proxy headers, it should
  // fall back to local filesystem and still render the config layout.
  it("should render config layout in PROXY_MODE=1 with components/layouts/ path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-e2e-proxy-config-layout-test-" });

    await Deno.writeTextFile(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "test-proxy-config-layout",
          type: "module",
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  fs: { type: "local" },
  layout: "components/layouts/DefaultLayout.tsx"
};`,
    );

    await Deno.mkdir(join(projectDir, "components/layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "components/layouts/DefaultLayout.tsx"),
      `
export default function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="proxy-config-layout">
      <nav id="proxy-config-nav">Proxy Config Nav</nav>
      <main>{children}</main>
      <footer id="proxy-config-footer">Proxy Config Footer</footer>
    </div>
  );
}
`,
    );

    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/index.tsx"),
      `
export default function Home() {
  return <div id="page-content">Proxy config layout page</div>;
}
`,
    );

    await withServer(
      projectDir,
      async (server) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        const html = await response.text();

        assertEquals(response.status, 200, `Should return 200, got ${response.status}`);
        assertStringIncludes(
          html,
          "proxy-config-layout",
          "Should have config layout in PROXY_MODE=1",
        );
        assertStringIncludes(html, "Proxy Config Nav", "Should render nav from config layout");
        assertStringIncludes(
          html,
          "Proxy Config Footer",
          "Should render footer from config layout",
        );
        assertStringIncludes(
          html,
          "Proxy config layout page",
          "Should render page content",
        );
      },
      "production",
      // Clear API env vars to test pure local filesystem fallback
      {
        PROXY_MODE: "1",
        PRODUCTION_MODE: "1",
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_API_TOKEN: "",
      },
    );
  });
});
