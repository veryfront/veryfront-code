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

import { assertEquals, assertStringIncludes, assert } from "#veryfront/testing/assert.ts";
import { describe, it, beforeAll } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";

const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") || "/tmp/veryfront-e2e-bin";
const BINARY_HASH_PATH = BINARY_PATH + ".srcHash";
let portCounter = 18100;

/**
 * Compute a hash of the source directory to detect code changes.
 * Uses git to get the tree hash of src/ which is fast and accurate.
 */
async function computeSourceHash(): Promise<string> {
  try {
    // Use git to compute tree hash of src/ - fast and handles all files
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD:src"],
      stdout: "piped",
      stderr: "null",
    });
    const result = await cmd.output();
    if (result.success) {
      return new TextDecoder().decode(result.stdout).trim();
    }
  } catch { /* fall through */ }

  // Fallback: use git status hash if tree hash fails
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const result = await cmd.output();
    if (result.success) {
      return new TextDecoder().decode(result.stdout).trim();
    }
  } catch { /* fall through */ }

  // Final fallback: timestamp-based (always recompile)
  return Date.now().toString();
}

interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
}

/**
 * Compile the binary if:
 * - It doesn't exist
 * - Source code has changed (hash mismatch)
 * - VERYFRONT_BINARY_FRESH=1 is set
 */
async function ensureBinaryCompiled(): Promise<void> {
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  // Check if we can reuse existing binary
  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) {
        console.log("✅ Using existing binary (source unchanged):", BINARY_PATH);
        return;
      }
      console.log("🔄 Source code changed, recompiling...");
    } catch {
      // No hash file - could be old binary, recompile to be safe
      console.log("🔄 No source hash found, recompiling...");
    }
  }

  if (forceFresh) {
    console.log("🗑️  Force fresh build (VERYFRONT_BINARY_FRESH=1)");
  }

  // Clean up old binary if exists
  if (binaryExists) {
    await Deno.remove(BINARY_PATH);
  }

  console.log("📦 Compiling binary...");
  const command = new Deno.Command("deno", {
    args: ["compile", "--allow-all", "--unstable-net", "--output", BINARY_PATH, "src/cli/main.ts"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await command.output();
  if (!result.success) throw new Error("Failed to compile binary");

  // Store the source hash for future comparisons
  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("✅ Binary compiled");
}

/**
 * Start the compiled binary server with unique port and cache directory
 */
async function startBinaryServer(projectDir: string): Promise<TestServer> {
  const logs: string[] = [];
  const port = portCounter++;
  const cacheDir = await Deno.makeTempDir({ prefix: "vf-cache-" });

  const command = new Deno.Command(BINARY_PATH, {
    args: ["dev", "-p", String(port), "--project", projectDir],
    env: {
      ...Deno.env.toObject(),
      NODE_ENV: "development",
      LOG_FORMAT: "text",
      VERYFRONT_CACHE_DIR: cacheDir,  // Unique cache per test
    },
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Collect logs in background
  const collectLogs = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        logs.push(decoder.decode(value));
      }
    } catch { /* closed */ }
  };
  collectLogs(process.stdout);
  collectLogs(process.stderr);

  // Wait for server to respond
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (Date.now() >= deadline) {
    process.kill();
    throw new Error(`Server failed to start on port ${port}`);
  }

  return {
    process, port, logs,
    kill: async () => {
      try { process.kill(); await process.status; } catch { /* already dead */ }
      await new Promise(r => setTimeout(r, 200)); // Port release time
      try { await Deno.remove(cacheDir, { recursive: true }); } catch { /* ignore */ }
    },
  };
}

/**
 * Create a test project with optional additional files
 */
async function createTestProject(
  name: string,
  pageContent: string,
  additionalFiles?: Record<string, string>,
): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-${name}-` });

  await Deno.writeTextFile(join(projectDir, "package.json"), JSON.stringify({
    name: `test-${name}`,
    type: "module",
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  }, null, 2));

  await Deno.writeTextFile(join(projectDir, "veryfront.config.ts"), `export default { fs: { type: "local" } };`);

  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "pages", "index.tsx"), pageContent);

  // Write additional files
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

describe("Compiled Binary E2E", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should render page with veryfront/head import correctly", async () => {
    const projectDir = await createTestProject("head-test", `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Head Component Test</title></Head>
      <div id="content">Head import works</div>
    </>
  );
}
`);

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assert(!html.includes("esm.sh/_vf_modules"), "Should not have esm.sh/_vf_modules error");
      assert(!html.includes("Module not found"), "Should not have module errors");
      assertStringIncludes(html, "Head import works", "Should render content");

      // Check logs for critical errors
      const errorLogs = server.logs.filter(l =>
        l.includes("esm.sh/_vf_modules") ||
        l.includes("dual React") ||
        l.includes("Invalid hook call")
      );
      assertEquals(errorLogs.length, 0, `Should have no critical errors: ${errorLogs.join("\n")}`);
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should render page with veryfront/router import correctly", async () => {
    const projectDir = await createTestProject("router-test", `
import { useRouter } from "veryfront/router";

export default function Home() {
  const router = useRouter();
  return <div id="content">Router pathname: {router.pathname}</div>;
}
`);

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("Module not found"), "Should resolve router import");
      assertStringIncludes(html, "Router pathname:");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should handle multiple framework imports without React errors", async () => {
    const projectDir = await createTestProject("multi-test", `
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
`);

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("esm.sh/_vf_modules"));
      assert(!html.includes("Invalid hook call"), "Should not have React hooks error");
      assertStringIncludes(html, "Multi Import Test");

      const hookErrors = server.logs.filter(l =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(hookErrors.length, 0, "Should have no hook errors");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should work with useState in client components", async () => {
    const projectDir = await createTestProject("hooks-test", `
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
`);

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assert(!html.includes("Invalid hook call"), "Should not have hooks error");
      assert(!html.includes("more than one copy of React"), "Should not have dual React error");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should not have cache path errors indicating cross-environment issues", async () => {
    const projectDir = await createTestProject("cache-test", `
import { Head } from "veryfront/head";

export default function Home() {
  return (
    <>
      <Head><title>Cache Test</title></Head>
      <div id="content">Cache isolation works</div>
    </>
  );
}
`);

    const server = await startBinaryServer(projectDir);
    try {
      // Make multiple requests
      await fetch(`http://127.0.0.1:${server.port}/`);
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200);
      assertStringIncludes(html, "Cache isolation works");

      // Check for file:// path errors (indicates cross-environment cache issue)
      const cacheErrors = server.logs.filter(l =>
        l.includes("file://") && l.includes("not found")
      );
      assertEquals(cacheErrors.length, 0, `Should have no cache path errors: ${cacheErrors.join("\n")}`);
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should render pages with _layout.tsx wrapping content", async () => {
    const projectDir = await createTestProject("layout-test", `
export default function Home() {
  return <div id="page-content">Home Page Content</div>;
}
`, {
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
    });

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "Site Header", "Should render layout header");
      assertStringIncludes(html, "Home Page Content", "Should render page content");
      assertStringIncludes(html, "Site Footer", "Should render layout footer");
      assertStringIncludes(html, "layout-wrapper", "Should have layout wrapper");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should render pages with app.tsx provider wrapping entire app", async () => {
    // Note: app.tsx must be in components/ directory, not project root
    const projectDir = await createTestProject("app-provider-test", `
export default function Home() {
  return <div id="page-content">Home page rendered</div>;
}
`, {
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
    });

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "app-wrapper", "Should have app wrapper from provider");
      assertStringIncludes(html, "App Header", "Should render app header");
      assertStringIncludes(html, "Home page rendered", "Should render page content");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should render nested layouts correctly", async () => {
    const projectDir = await createTestProject("nested-layout-test", `
export default function DashboardHome() {
  return <div id="dashboard-content">Dashboard Home</div>;
}
`, {
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
    });

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/dashboard`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "root-layout", "Should have root layout");
      assertStringIncludes(html, "Root Nav", "Should render root nav");
      assertStringIncludes(html, "dashboard-layout", "Should have dashboard layout");
      assertStringIncludes(html, "Dashboard Sidebar", "Should render dashboard sidebar");
      assertStringIncludes(html, "Dashboard Index Page", "Should render dashboard content");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should work with app.tsx and layout.tsx together", async () => {
    // Note: app.tsx must be in components/ directory, not project root
    const projectDir = await createTestProject("app-layout-combo-test", `
export default function Home() {
  return <div id="page-content">Home Page Content</div>;
}
`, {
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
    });

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");
      assertStringIncludes(html, "app-root", "Should have app wrapper");
      assertStringIncludes(html, "App Banner", "Should render app banner");
      assertStringIncludes(html, "layout-container", "Should have layout container");
      assertStringIncludes(html, "Layout Header", "Should render layout header");
      assertStringIncludes(html, "Home Page Content", "Should render page content");

      // Verify no React errors
      const reactErrors = server.logs.filter(l =>
        l.includes("Invalid hook call") || l.includes("more than one copy of React")
      );
      assertEquals(reactErrors.length, 0, "Should have no React errors");
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should share page context between layout and page via usePageContext", async () => {
    const projectDir = await createTestProject("page-context-test", `
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
`, {
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
    });

    const server = await startBinaryServer(projectDir);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      assertEquals(response.status, 200, "Should return 200");

      // Both layout and page should be rendered
      assertStringIncludes(html, "layout-wrapper", "Should have layout wrapper");
      assertStringIncludes(html, "page-content", "Should have page content");

      // Check for no critical errors
      const errors = server.logs.filter(l =>
        l.includes("Invalid hook call") || l.includes("Module not found")
      );
      assertEquals(errors.length, 0, `Should have no errors: ${errors.join("\n")}`);
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
