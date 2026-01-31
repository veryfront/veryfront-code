#!/usr/bin/env -S deno test --allow-all
/**
 * Compiled Binary E2E Tests - Kitchen Sink
 *
 * Tests the compiled binary distribution to ensure:
 * - Framework module resolution (/_vf_modules/_veryfront/) works
 * - Cache isolation between environments
 * - No dual React instance errors
 * - SSR rendering with framework components
 *
 * Run:
 *   deno test --allow-all tests/integration/compiled-binary-e2e.test.ts
 */

import { assertEquals, assertStringIncludes, assert } from "#veryfront/testing/assert.ts";
import { describe, it, beforeAll } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";

const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") || "/tmp/veryfront-e2e-bin";
let portCounter = 18100;

interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
}

/**
 * Compile the binary if it doesn't exist
 */
async function ensureBinaryCompiled(): Promise<void> {
  const binaryExists = await exists(BINARY_PATH);
  if (!binaryExists) {
    console.log("📦 Compiling binary...");
    const command = new Deno.Command("deno", {
      args: ["compile", "--allow-all", "--unstable-net", "--output", BINARY_PATH, "src/cli/main.ts"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const result = await command.output();
    if (!result.success) throw new Error("Failed to compile binary");
    console.log("✅ Binary compiled");
  } else {
    console.log("✅ Using existing binary:", BINARY_PATH);
  }
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
 * Create a test project
 */
async function createTestProject(name: string, pageContent: string): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-${name}-` });

  await Deno.writeTextFile(join(projectDir, "package.json"), JSON.stringify({
    name: `test-${name}`,
    type: "module",
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  }, null, 2));

  await Deno.writeTextFile(join(projectDir, "veryfront.config.ts"), `export default { fs: { type: "local" } };`);

  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "pages", "index.tsx"), pageContent);

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
});
