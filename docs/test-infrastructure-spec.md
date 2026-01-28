# Test Infrastructure and Patterns Specification

## Overview

This document specifies the test infrastructure, fixtures, utilities, and patterns needed for comprehensive testing of veryfront-renderer across multiple adapters (Local, API, GitHub), multi-tenant environments, and deployment modes.

---

## 1. Test Fixtures

### 1.1 Mock Project Configuration

```typescript
// tests/fixtures/project-fixtures.ts

import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import type { VeryfrontConfig } from "@veryfront/config";

/**
 * Standard project templates for testing
 */
export interface ProjectFixture {
  name: string;
  files: Record<string, string>;
  config?: Partial<VeryfrontConfig>;
}

/**
 * Pre-defined project fixtures for common test scenarios
 */
export const PROJECT_FIXTURES = {
  /** Minimal app router project */
  minimal: {
    name: "minimal",
    files: {
      "app/page.tsx": `export default function Home() { return <h1>Hello</h1>; }`,
      "app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
    },
    config: { title: "Minimal Test" },
  },

  /** MDX-based blog project */
  blog: {
    name: "blog",
    files: {
      "app/page.mdx": `# Welcome to the Blog\n\nThis is a test blog.`,
      "app/layout.tsx": `export default function Layout({ children }) {
        return <html><body><main>{children}</main></body></html>;
      }`,
      "app/posts/[slug]/page.mdx": `# Post: {params.slug}`,
    },
    config: { title: "Test Blog" },
  },

  /** API routes project */
  api: {
    name: "api",
    files: {
      "app/api/health/route.ts": `export function GET() { return Response.json({ status: "ok" }); }`,
      "app/api/users/route.ts": `
        export function GET() { return Response.json({ users: [] }); }
        export async function POST(req: Request) {
          const body = await req.json();
          return Response.json({ created: body });
        }
      `,
      "app/api/users/[id]/route.ts": `
        export function GET(req: Request, { params }) {
          return Response.json({ id: params.id });
        }
      `,
    },
    config: { title: "API Test" },
  },

  /** Full-featured project with all components */
  fullStack: {
    name: "full-stack",
    files: {
      "app/layout.tsx": `
        import "./globals.css";
        export const metadata = { title: "Full Stack App" };
        export default function Layout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
      "app/page.tsx": `
        import { getData } from "./actions";
        export default async function Home() {
          const data = await getData();
          return <div><h1>Home</h1><pre>{JSON.stringify(data)}</pre></div>;
        }
      `,
      "app/actions.ts": `"use server"; export async function getData() { return { timestamp: Date.now() }; }`,
      "app/dashboard/page.tsx": `export default function Dashboard() { return <h1>Dashboard</h1>; }`,
      "app/dashboard/layout.tsx": `export default function DashboardLayout({ children }) { return <div className="dashboard">{children}</div>; }`,
      "app/api/data/route.ts": `export function GET() { return Response.json({ data: [] }); }`,
      "app/globals.css": `body { margin: 0; font-family: sans-serif; }`,
      "components/Button.tsx": `export function Button({ children }) { return <button>{children}</button>; }`,
      "public/favicon.ico": "", // Binary placeholder
    },
    config: {
      title: "Full Stack Test",
      cache: { render: { type: "memory", ttl: 30000 } },
    },
  },

  /** AI agent project */
  agent: {
    name: "agent",
    files: {
      "app/page.tsx": `
        "use client";
        import { useChat } from "veryfront/agent/react";
        export default function Chat() {
          const { messages, sendMessage } = useChat();
          return <div>{messages.map(m => <p key={m.id}>{m.content}</p>)}</div>;
        }
      `,
      "app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
      "agents/chat.ts": `
        import { createAgent } from "veryfront/agent";
        export default createAgent({ name: "chat", model: "gpt-4" });
      `,
      "tools/search.ts": `
        import { tool } from "veryfront/tool";
        import { z } from "zod";
        export default tool({
          name: "search",
          description: "Search for information",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => ({ results: [] }),
        });
      `,
    },
    config: { title: "Agent Test" },
  },
} as const;

/**
 * Creates a project fixture in a directory
 */
export async function createProjectFixture(
  projectDir: string,
  fixture: ProjectFixture | keyof typeof PROJECT_FIXTURES,
): Promise<void> {
  const fixtureData = typeof fixture === "string"
    ? PROJECT_FIXTURES[fixture]
    : fixture;

  // Create all files
  for (const [filePath, content] of Object.entries(fixtureData.files)) {
    const fullPath = join(projectDir, filePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeTextFile(fullPath, content);
  }

  // Create config file
  const config = {
    title: fixtureData.name,
    ...fixtureData.config,
  };
  await writeTextFile(
    join(projectDir, "veryfront.config.js"),
    `export default ${JSON.stringify(config, null, 2)};`,
  );
}

/**
 * Creates a custom project with specific files
 */
export async function createCustomProject(
  projectDir: string,
  files: Record<string, string>,
  config?: Partial<VeryfrontConfig>,
): Promise<void> {
  await createProjectFixture(projectDir, {
    name: "custom",
    files,
    config,
  });
}
```

### 1.2 Adapter Test Fixtures

```typescript
// tests/fixtures/adapter-fixtures.ts

import type { FSAdapter } from "@veryfront/platform/adapters/fs/veryfront/types.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "@veryfront/platform/adapters/mock.ts";

/**
 * Creates a test adapter with pre-populated files
 */
export function createTestAdapter(
  type: "local" | "api" | "github" | "memory",
  files: Record<string, string>,
  options?: {
    projectSlug?: string;
    projectId?: string;
    token?: string;
    branch?: string;
    releaseId?: string;
    productionMode?: boolean;
  },
): RuntimeAdapter & { fs: { files: Map<string, string> } } {
  const adapter = createMockAdapter();

  // Populate files
  for (const [path, content] of Object.entries(files)) {
    adapter.fs.files.set(path, content);

    // Auto-create parent directories
    const parts = path.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current += (current ? "/" : "") + parts[i];
      adapter.fs.directories.add(current);
    }
  }

  // Set environment variables for adapter type simulation
  if (options?.projectSlug) {
    adapter.env.set("VERYFRONT_PROJECT_SLUG", options.projectSlug);
  }
  if (options?.token) {
    adapter.env.set("VERYFRONT_API_TOKEN", options.token);
  }
  if (options?.productionMode) {
    adapter.env.set("PRODUCTION_MODE", "1");
  }

  return adapter;
}

/**
 * Creates an FS adapter for testing file operations
 */
export interface MockFSAdapter extends FSAdapter {
  _files: Map<string, string>;
  _setFile(path: string, content: string): void;
  _deleteFile(path: string): void;
  _clear(): void;
}

export function createMockFSAdapter(
  files: Record<string, string> = {},
): MockFSAdapter {
  const fileMap = new Map<string, string>(Object.entries(files));

  return {
    _files: fileMap,
    _setFile: (path, content) => fileMap.set(path, content),
    _deleteFile: (path) => fileMap.delete(path),
    _clear: () => fileMap.clear(),

    async readFile(path) {
      const content = fileMap.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },

    async readTextFile(path) {
      return this.readFile(path);
    },

    async exists(path) {
      if (fileMap.has(path)) return true;
      // Check if it's a directory
      for (const key of fileMap.keys()) {
        if (key.startsWith(path + "/")) return true;
      }
      return false;
    },

    async stat(path) {
      const content = fileMap.get(path);
      if (content !== undefined) {
        return {
          size: content.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(),
        };
      }
      // Check if directory
      for (const key of fileMap.keys()) {
        if (key.startsWith(path + "/")) {
          return {
            size: 0,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            mtime: new Date(),
          };
        }
      }
      throw new Error(`Path not found: ${path}`);
    },

    async readdir(path) {
      const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();
      const prefix = path ? path + "/" : "";

      for (const filePath of fileMap.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const relativePath = filePath.slice(prefix.length);
        const [name, ...rest] = relativePath.split("/");
        if (!name) continue;

        if (!entries.has(name)) {
          entries.set(name, {
            isFile: rest.length === 0,
            isDirectory: rest.length > 0,
          });
        }
      }

      return Array.from(entries).map(([name, meta]) => ({
        name,
        ...meta,
        isSymlink: false,
      }));
    },

    async resolveFile(basePath) {
      const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
      for (const ext of extensions) {
        if (fileMap.has(basePath + ext)) return basePath + ext;
      }
      for (const ext of extensions) {
        if (fileMap.has(basePath + "/index" + ext)) return basePath + "/index" + ext;
      }
      return null;
    },

    dispose() {
      fileMap.clear();
    },
  };
}
```

### 1.3 Multi-Project Environment Fixtures

```typescript
// tests/fixtures/multi-project-fixtures.ts

import { TestContext, withTestContext } from "../_helpers/context.ts";

/**
 * Project configuration for multi-tenant testing
 */
export interface TenantProject {
  slug: string;
  id?: string;
  files: Record<string, string>;
  config?: Record<string, unknown>;
  environment?: "preview" | "production";
  branch?: string;
  releaseId?: string;
}

/**
 * Creates multiple isolated test projects for multi-tenant testing
 */
export async function withMultiProjectEnvironment<T>(
  projects: TenantProject[],
  testFn: (contexts: Map<string, TestContext>) => Promise<T>,
): Promise<T> {
  const contexts = new Map<string, TestContext>();

  try {
    // Create all project contexts
    for (const project of projects) {
      const context = new TestContext(`multi-${project.slug}`);
      await context.setup();

      // Create project files
      for (const [path, content] of Object.entries(project.files)) {
        const fullPath = `${context.projectDir}/${path}`;
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(fullPath, content);
      }

      contexts.set(project.slug, context);
    }

    return await testFn(contexts);
  } finally {
    // Cleanup all contexts
    for (const context of contexts.values()) {
      await context.cleanup();
    }
  }
}

/**
 * Simulates concurrent requests to multiple projects
 */
export async function simulateConcurrentProjects(
  contexts: Map<string, TestContext>,
  requests: Array<{ projectSlug: string; path: string; method?: string }>,
): Promise<Array<{ projectSlug: string; response: Response; duration: number }>> {
  const results: Array<{ projectSlug: string; response: Response; duration: number }> = [];

  const promises = requests.map(async (req) => {
    const context = contexts.get(req.projectSlug);
    if (!context) throw new Error(`Project not found: ${req.projectSlug}`);

    // Ensure server is running
    let server = context["servers"]?.[0];
    if (!server) {
      server = await context.createDevServer();
    }

    const start = performance.now();
    const response = await fetch(
      `http://${server.hostname}:${server.port}${req.path}`,
      { method: req.method || "GET" },
    );
    const duration = performance.now() - start;

    return { projectSlug: req.projectSlug, response, duration };
  });

  return Promise.all(promises);
}
```

---

## 2. Test Utilities

### 2.1 Core Test Utilities

```typescript
// tests/utilities/test-adapter.ts

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "@veryfront/platform/adapters/mock.ts";
import { createRenderer, type Renderer } from "@veryfront/rendering";

/**
 * Creates a test adapter with specified type and files
 */
export function createTestAdapter(
  type: "local" | "api" | "github",
  files: Record<string, string>,
  options?: {
    cache?: boolean;
    ttl?: number;
  },
): RuntimeAdapter {
  const adapter = createMockAdapter();

  // Populate files
  for (const [path, content] of Object.entries(files)) {
    adapter.fs.files.set(path, content);
  }

  return adapter;
}

/**
 * Creates a test project with files and optional configuration
 */
export interface TestProject {
  projectDir: string;
  adapter: RuntimeAdapter;
  renderer?: Renderer;
  cleanup: () => Promise<void>;
}

export async function createTestProject(
  config: {
    files: Record<string, string>;
    veryfrontConfig?: Record<string, unknown>;
    adapterType?: "local" | "api" | "github";
    createRenderer?: boolean;
  },
): Promise<TestProject> {
  const adapter = createTestAdapter(
    config.adapterType || "local",
    config.files,
  );

  // Create temp directory path for projectDir
  const projectDir = `/tmp/veryfront_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  let renderer: Renderer | undefined;
  if (config.createRenderer) {
    renderer = await createRenderer({
      projectDir,
      mode: "development",
    });
  }

  return {
    projectDir,
    adapter,
    renderer,
    cleanup: async () => {
      adapter.fs.files.clear();
      adapter.fs.directories.clear();
      if (renderer?.clearAllState) {
        await renderer.clearAllState();
      }
    },
  };
}
```

### 2.2 Rendering Test Utilities

```typescript
// tests/utilities/render-utils.ts

import { createRenderer, type Renderer } from "@veryfront/rendering";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

export interface RenderResult {
  html: string;
  status: number;
  headers: Headers;
  duration: number;
}

/**
 * Renders a route with the specified adapter and returns detailed results
 */
export async function renderWithAdapter(
  adapter: RuntimeAdapter,
  projectDir: string,
  route: string,
  options?: {
    mode?: "development" | "production";
    headers?: Record<string, string>;
  },
): Promise<RenderResult> {
  const renderer = await createRenderer({
    projectDir,
    mode: options?.mode || "development",
  });

  const start = performance.now();
  try {
    const result = await renderer.renderPage(route);
    return {
      html: result.html,
      status: result.status || 200,
      headers: new Headers(result.headers || {}),
      duration: performance.now() - start,
    };
  } finally {
    if (renderer.clearAllState) {
      await renderer.clearAllState();
    }
  }
}

/**
 * Renders multiple routes and compares results
 */
export async function renderMultiple(
  adapter: RuntimeAdapter,
  projectDir: string,
  routes: string[],
): Promise<Map<string, RenderResult>> {
  const results = new Map<string, RenderResult>();

  for (const route of routes) {
    const result = await renderWithAdapter(adapter, projectDir, route);
    results.set(route, result);
  }

  return results;
}

/**
 * Asserts that two render results are equivalent
 */
export function assertRenderEquivalent(
  result1: RenderResult,
  result2: RenderResult,
  options?: {
    ignoreWhitespace?: boolean;
    ignoreTimestamps?: boolean;
  },
): void {
  let html1 = result1.html;
  let html2 = result2.html;

  if (options?.ignoreWhitespace) {
    html1 = html1.replace(/\s+/g, " ").trim();
    html2 = html2.replace(/\s+/g, " ").trim();
  }

  if (options?.ignoreTimestamps) {
    // Remove timestamp-like patterns
    const timestampPattern = /\d{10,13}/g;
    html1 = html1.replace(timestampPattern, "TIMESTAMP");
    html2 = html2.replace(timestampPattern, "TIMESTAMP");
  }

  if (html1 !== html2) {
    throw new Error(
      `Render results differ:\n` +
      `Result 1 (${result1.duration.toFixed(2)}ms):\n${html1.slice(0, 500)}...\n\n` +
      `Result 2 (${result2.duration.toFixed(2)}ms):\n${html2.slice(0, 500)}...`,
    );
  }
}
```

### 2.3 Cache Testing Utilities

```typescript
// tests/utilities/cache-utils.ts

import { FileCache } from "@veryfront/platform/adapters/fs/cache/file-cache.ts";

export interface CacheTestResult {
  operation: "hit" | "miss";
  key: string;
  value?: unknown;
  duration: number;
}

/**
 * Creates a cache for testing with tracking
 */
export function createTestCache(options?: {
  maxSize?: number;
  ttl?: number;
}): FileCache & {
  getOperations(): CacheTestResult[];
  clearOperations(): void;
} {
  const operations: CacheTestResult[] = [];
  const cache = new FileCache({
    maxSize: options?.maxSize ?? 100,
    ttl: options?.ttl ?? 60000,
  });

  // Wrap get to track operations
  const originalGet = cache.get.bind(cache);
  cache.get = (key: string) => {
    const start = performance.now();
    const value = originalGet(key);
    operations.push({
      operation: value !== undefined ? "hit" : "miss",
      key,
      value,
      duration: performance.now() - start,
    });
    return value;
  };

  return Object.assign(cache, {
    getOperations: () => [...operations],
    clearOperations: () => { operations.length = 0; },
  });
}

/**
 * Compares cache hit/miss patterns between two scenarios
 */
export interface CacheComparisonResult {
  scenario1Hits: number;
  scenario1Misses: number;
  scenario2Hits: number;
  scenario2Misses: number;
  hitRateImprovement: number;
}

export function compareCachePatterns(
  operations1: CacheTestResult[],
  operations2: CacheTestResult[],
): CacheComparisonResult {
  const hits1 = operations1.filter(o => o.operation === "hit").length;
  const misses1 = operations1.filter(o => o.operation === "miss").length;
  const hits2 = operations2.filter(o => o.operation === "hit").length;
  const misses2 = operations2.filter(o => o.operation === "miss").length;

  const hitRate1 = hits1 / (hits1 + misses1) || 0;
  const hitRate2 = hits2 / (hits2 + misses2) || 0;

  return {
    scenario1Hits: hits1,
    scenario1Misses: misses1,
    scenario2Hits: hits2,
    scenario2Misses: misses2,
    hitRateImprovement: hitRate2 - hitRate1,
  };
}

/**
 * Tests cache isolation between projects
 */
export async function testCacheIsolation(
  cache: FileCache,
  project1Key: string,
  project2Key: string,
): Promise<{ isolated: boolean; details: string }> {
  // Write to project 1
  cache.set(`${project1Key}:file:test.tsx`, "project1 content");

  // Write to project 2
  cache.set(`${project2Key}:file:test.tsx`, "project2 content");

  // Verify isolation
  const p1Value = cache.get(`${project1Key}:file:test.tsx`);
  const p2Value = cache.get(`${project2Key}:file:test.tsx`);

  if (p1Value !== "project1 content" || p2Value !== "project2 content") {
    return {
      isolated: false,
      details: `Cache leak detected: p1="${p1Value}", p2="${p2Value}"`,
    };
  }

  // Clear project 1, verify project 2 unaffected
  cache.deleteByPrefix(project1Key);

  const p1AfterClear = cache.get(`${project1Key}:file:test.tsx`);
  const p2AfterClear = cache.get(`${project2Key}:file:test.tsx`);

  if (p1AfterClear !== undefined || p2AfterClear !== "project2 content") {
    return {
      isolated: false,
      details: `Prefix deletion affected wrong project: p1="${p1AfterClear}", p2="${p2AfterClear}"`,
    };
  }

  return { isolated: true, details: "Cache properly isolated" };
}
```

### 2.4 Performance Testing Utilities

```typescript
// tests/utilities/perf-utils.ts

import { PERFORMANCE_BUDGETS } from "../_helpers/constants.ts";

export interface PerfMetrics {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
}

/**
 * Runs a function multiple times and collects performance metrics
 */
export async function measurePerformance(
  fn: () => Promise<void>,
  iterations: number = 10,
  warmupIterations: number = 2,
): Promise<PerfMetrics> {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  // Collect measurements
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);

  const sum = times.reduce((a, b) => a + b, 0);
  const mean = sum / times.length;
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1] ?? 0;
  const p99 = times[Math.floor(times.length * 0.99)] ?? times[times.length - 1] ?? 0;

  const squaredDiffs = times.map(t => (t - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / times.length;
  const stdDev = Math.sqrt(variance);

  return {
    min: times[0] ?? 0,
    max: times[times.length - 1] ?? 0,
    mean,
    median,
    p95,
    p99,
    stdDev,
  };
}

/**
 * Asserts performance is within budget
 */
export function assertWithinBudget(
  metrics: PerfMetrics,
  budget: keyof typeof PERFORMANCE_BUDGETS,
  options?: { useP95?: boolean },
): void {
  const threshold = PERFORMANCE_BUDGETS[budget];
  const actual = options?.useP95 ? metrics.p95 : metrics.median;

  if (actual > threshold) {
    throw new Error(
      `Performance budget exceeded for ${budget}: ` +
      `${actual.toFixed(2)}ms > ${threshold}ms budget\n` +
      `Metrics: min=${metrics.min.toFixed(2)}ms, ` +
      `median=${metrics.median.toFixed(2)}ms, ` +
      `p95=${metrics.p95.toFixed(2)}ms, ` +
      `max=${metrics.max.toFixed(2)}ms`,
    );
  }
}

/**
 * Compares performance between two implementations
 */
export interface PerfComparison {
  baseline: PerfMetrics;
  candidate: PerfMetrics;
  improvement: number; // Negative means regression
  significantDifference: boolean;
}

export async function comparePerformance(
  baseline: () => Promise<void>,
  candidate: () => Promise<void>,
  iterations: number = 20,
): Promise<PerfComparison> {
  const baselineMetrics = await measurePerformance(baseline, iterations);
  const candidateMetrics = await measurePerformance(candidate, iterations);

  const improvement = (baselineMetrics.median - candidateMetrics.median) / baselineMetrics.median;

  // Statistical significance check (simplified - uses 2 standard deviations)
  const combinedStdDev = Math.sqrt(baselineMetrics.stdDev ** 2 + candidateMetrics.stdDev ** 2);
  const difference = Math.abs(baselineMetrics.median - candidateMetrics.median);
  const significantDifference = difference > 2 * combinedStdDev;

  return {
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    improvement,
    significantDifference,
  };
}
```

---

## 3. Reusable Test Patterns

### 3.1 Cross-Adapter Consistency Pattern

```typescript
// tests/patterns/cross-adapter-consistency.ts

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createTestAdapter } from "../utilities/test-adapter.ts";
import { renderWithAdapter, assertRenderEquivalent } from "../utilities/render-utils.ts";

/**
 * Pattern for testing that behavior is consistent across all adapter types
 */
export function testCrossAdapterConsistency(
  testName: string,
  files: Record<string, string>,
  routes: string[],
  assertions: (results: Map<string, Map<string, { html: string; status: number }>>) => void,
) {
  const adapterTypes = ["local", "api", "github"] as const;

  describe(`Cross-Adapter Consistency: ${testName}`, () => {
    const resultsByAdapter = new Map<string, Map<string, { html: string; status: number }>>();

    for (const adapterType of adapterTypes) {
      describe(`${adapterType} adapter`, () => {
        const routeResults = new Map<string, { html: string; status: number }>();

        for (const route of routes) {
          it(`renders ${route} correctly`, async () => {
            const adapter = createTestAdapter(adapterType, files);
            const result = await renderWithAdapter(adapter, "/test", route);

            routeResults.set(route, { html: result.html, status: result.status });

            // Basic assertions
            assertEquals(result.status >= 200 && result.status < 500, true);
          });
        }

        resultsByAdapter.set(adapterType, routeResults);
      });
    }

    describe("consistency checks", () => {
      it("all adapters produce equivalent results", () => {
        const [first, ...rest] = [...resultsByAdapter.entries()];
        if (!first) return;

        const [firstType, firstResults] = first;

        for (const [otherType, otherResults] of rest) {
          for (const route of routes) {
            const firstResult = firstResults.get(route);
            const otherResult = otherResults.get(route);

            if (firstResult && otherResult) {
              assertRenderEquivalent(
                { ...firstResult, headers: new Headers(), duration: 0 },
                { ...otherResult, headers: new Headers(), duration: 0 },
                { ignoreWhitespace: true, ignoreTimestamps: true },
              );
            }
          }
        }
      });

      it("passes custom assertions", () => {
        assertions(resultsByAdapter);
      });
    });
  });
}

// Usage example:
/*
testCrossAdapterConsistency(
  "basic page rendering",
  {
    "app/page.tsx": `export default function Home() { return <h1>Hello</h1>; }`,
    "app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  },
  ["/", "/about"],
  (results) => {
    // Custom assertions on results
    for (const [adapter, routes] of results) {
      const homeResult = routes.get("/");
      assertEquals(homeResult?.html.includes("Hello"), true);
    }
  },
);
*/
```

### 3.2 Multi-Tenant Isolation Pattern

```typescript
// tests/patterns/multi-tenant-isolation.ts

import { assertEquals, assertNotEquals } from "@veryfront/testing/assert";
import { describe, it, beforeAll, afterAll } from "@veryfront/testing/bdd";
import { withMultiProjectEnvironment, TenantProject } from "../fixtures/multi-project-fixtures.ts";

/**
 * Pattern for testing multi-tenant isolation
 */
export function testMultiTenantIsolation(
  testName: string,
  tenants: TenantProject[],
  isolationTests: Array<{
    name: string;
    test: (contexts: Map<string, TestContext>) => Promise<void>;
  }>,
) {
  describe(`Multi-Tenant Isolation: ${testName}`, () => {
    for (const { name, test } of isolationTests) {
      it(name, async () => {
        await withMultiProjectEnvironment(tenants, test);
      });
    }
  });
}

/**
 * Pre-built isolation test cases
 */
export const ISOLATION_TESTS = {
  /** Verifies render output is isolated per tenant */
  renderIsolation: {
    name: "render output is isolated per tenant",
    test: async (contexts: Map<string, TestContext>) => {
      for (const [slug, context] of contexts) {
        const server = await context.createDevServer();
        const response = await fetch(`http://localhost:${server.port}/`);
        const html = await response.text();

        // Should only contain this tenant's content
        assertEquals(html.includes(slug), true);

        // Should not contain other tenants' content
        for (const [otherSlug] of contexts) {
          if (otherSlug !== slug) {
            assertEquals(html.includes(otherSlug), false);
          }
        }
      }
    },
  },

  /** Verifies cache is isolated per tenant */
  cacheIsolation: {
    name: "cache is isolated per tenant",
    test: async (contexts: Map<string, TestContext>) => {
      const servers = new Map<string, { port: number }>();

      // Start all servers
      for (const [slug, context] of contexts) {
        const server = await context.createDevServer();
        servers.set(slug, { port: server.port });
      }

      // Make requests to populate cache
      for (const [slug, { port }] of servers) {
        await fetch(`http://localhost:${port}/`);
      }

      // Modify one tenant
      const [firstSlug, firstContext] = [...contexts.entries()][0]!;
      await Deno.writeTextFile(
        `${firstContext.projectDir}/app/page.tsx`,
        `export default function Home() { return <h1>Modified ${firstSlug}</h1>; }`,
      );

      // Verify other tenants unaffected
      for (const [slug, { port }] of servers) {
        if (slug === firstSlug) continue;

        const response = await fetch(`http://localhost:${port}/`);
        const html = await response.text();

        // Should still have original content
        assertNotEquals(html.includes("Modified"), true);
      }
    },
  },

  /** Verifies API routes are isolated per tenant */
  apiIsolation: {
    name: "API routes are isolated per tenant",
    test: async (contexts: Map<string, TestContext>) => {
      for (const [slug, context] of contexts) {
        // Add API route dynamically
        await Deno.mkdir(`${context.projectDir}/app/api`, { recursive: true });
        await Deno.writeTextFile(
          `${context.projectDir}/app/api/info/route.ts`,
          `export function GET() { return Response.json({ tenant: "${slug}" }); }`,
        );

        const server = await context.createDevServer();
        const response = await fetch(`http://localhost:${server.port}/api/info`);
        const data = await response.json();

        assertEquals(data.tenant, slug);
      }
    },
  },
};

// Usage example:
/*
testMultiTenantIsolation(
  "basic tenant isolation",
  [
    { slug: "tenant-a", files: { "app/page.tsx": `export default () => <h1>Tenant A</h1>` } },
    { slug: "tenant-b", files: { "app/page.tsx": `export default () => <h1>Tenant B</h1>` } },
  ],
  [
    ISOLATION_TESTS.renderIsolation,
    ISOLATION_TESTS.cacheIsolation,
    ISOLATION_TESTS.apiIsolation,
  ],
);
*/
```

### 3.3 Cache Hit/Miss Comparison Pattern

```typescript
// tests/patterns/cache-comparison.ts

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createTestCache, compareCachePatterns } from "../utilities/cache-utils.ts";

/**
 * Pattern for comparing cache behavior between scenarios
 */
export function testCacheComparison(
  testName: string,
  setup: () => Promise<{ cache: ReturnType<typeof createTestCache> }>,
  scenarios: {
    cold: () => Promise<void>;
    warm: () => Promise<void>;
  },
  expectations: {
    minHitRateImprovement: number;
    maxColdMisses?: number;
    minWarmHits?: number;
  },
) {
  describe(`Cache Comparison: ${testName}`, () => {
    it("cold cache has expected misses", async () => {
      const { cache } = await setup();
      cache.clearOperations();

      await scenarios.cold();

      const ops = cache.getOperations();
      const misses = ops.filter(o => o.operation === "miss").length;

      if (expectations.maxColdMisses !== undefined) {
        assert(
          misses <= expectations.maxColdMisses,
          `Cold cache had ${misses} misses, expected max ${expectations.maxColdMisses}`,
        );
      }
    });

    it("warm cache has expected hits", async () => {
      const { cache } = await setup();

      // Warm up
      await scenarios.cold();
      cache.clearOperations();

      // Measure warm
      await scenarios.warm();

      const ops = cache.getOperations();
      const hits = ops.filter(o => o.operation === "hit").length;

      if (expectations.minWarmHits !== undefined) {
        assert(
          hits >= expectations.minWarmHits,
          `Warm cache had ${hits} hits, expected min ${expectations.minWarmHits}`,
        );
      }
    });

    it("hit rate improves between cold and warm", async () => {
      const { cache } = await setup();

      // Cold run
      cache.clearOperations();
      await scenarios.cold();
      const coldOps = cache.getOperations();

      // Warm run
      cache.clearOperations();
      await scenarios.warm();
      const warmOps = cache.getOperations();

      const comparison = compareCachePatterns(coldOps, warmOps);

      assert(
        comparison.hitRateImprovement >= expectations.minHitRateImprovement,
        `Hit rate improvement was ${(comparison.hitRateImprovement * 100).toFixed(1)}%, ` +
        `expected min ${(expectations.minHitRateImprovement * 100).toFixed(1)}%`,
      );
    });
  });
}
```

### 3.4 Before/After Deployment Mode Pattern

```typescript
// tests/patterns/deployment-mode.ts

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../_helpers/context.ts";

/**
 * Pattern for testing behavior differences between deployment modes
 */
export function testDeploymentModes(
  testName: string,
  projectFiles: Record<string, string>,
  testCases: Array<{
    route: string;
    dev: { expectInHtml?: string[]; expectStatus?: number };
    prod: { expectInHtml?: string[]; expectStatus?: number };
  }>,
) {
  describe(`Deployment Modes: ${testName}`, () => {
    describe("development mode", () => {
      for (const testCase of testCases) {
        it(`${testCase.route} behaves correctly`, async () => {
          await withTestContext(`dev-${testCase.route}`, async (context) => {
            // Create project files
            for (const [path, content] of Object.entries(projectFiles)) {
              const fullPath = `${context.projectDir}/${path}`;
              const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
              await Deno.mkdir(dir, { recursive: true });
              await Deno.writeTextFile(fullPath, content);
            }

            const server = await context.createDevServer();
            const response = await fetch(`http://localhost:${server.port}${testCase.route}`);
            const html = await response.text();

            if (testCase.dev.expectStatus) {
              assertEquals(response.status, testCase.dev.expectStatus);
            }

            for (const expected of testCase.dev.expectInHtml || []) {
              assertEquals(html.includes(expected), true, `Expected "${expected}" in dev HTML`);
            }
          });
        });
      }
    });

    describe("production mode", () => {
      for (const testCase of testCases) {
        it(`${testCase.route} behaves correctly`, async () => {
          await withTestContext(`prod-${testCase.route}`, async (context) => {
            // Create project files
            for (const [path, content] of Object.entries(projectFiles)) {
              const fullPath = `${context.projectDir}/${path}`;
              const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
              await Deno.mkdir(dir, { recursive: true });
              await Deno.writeTextFile(fullPath, content);
            }

            const server = await context.createProductionServer();
            const response = await fetch(`http://localhost:${server.port}${testCase.route}`);
            const html = await response.text();

            if (testCase.prod.expectStatus) {
              assertEquals(response.status, testCase.prod.expectStatus);
            }

            for (const expected of testCase.prod.expectInHtml || []) {
              assertEquals(html.includes(expected), true, `Expected "${expected}" in prod HTML`);
            }
          });
        });
      }
    });
  });
}
```

### 3.5 Regression Snapshot Pattern

```typescript
// tests/patterns/regression-snapshot.ts

import { assertEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

/**
 * Normalizes HTML for snapshot comparison
 */
export function normalizeHtml(html: string): string {
  return html
    // Remove timestamps and random IDs
    .replace(/\d{10,13}/g, "TIMESTAMP")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "UUID")
    .replace(/id="[^"]*-\d+"/g, 'id="DYNAMIC_ID"')
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

/**
 * Pattern for regression testing with snapshots
 */
export interface RegressionSnapshot {
  route: string;
  normalizedHtml: string;
  status: number;
  headerKeys: string[];
}

export async function createSnapshot(
  serverPort: number,
  route: string,
): Promise<RegressionSnapshot> {
  const response = await fetch(`http://localhost:${serverPort}${route}`);
  const html = await response.text();

  return {
    route,
    normalizedHtml: normalizeHtml(html),
    status: response.status,
    headerKeys: [...response.headers.keys()].sort(),
  };
}

export function assertSnapshotMatch(
  actual: RegressionSnapshot,
  expected: RegressionSnapshot,
): void {
  assertEquals(actual.status, expected.status, `Status mismatch for ${actual.route}`);
  assertEquals(actual.normalizedHtml, expected.normalizedHtml, `HTML mismatch for ${actual.route}`);
  assertEquals(
    actual.headerKeys,
    expected.headerKeys,
    `Header keys mismatch for ${actual.route}`,
  );
}

/**
 * Pattern for regression testing multiple routes
 */
export function testRegression(
  testName: string,
  setupFn: () => Promise<{ port: number; cleanup: () => Promise<void> }>,
  routes: string[],
  expectedSnapshots: Map<string, RegressionSnapshot>,
) {
  describe(`Regression: ${testName}`, () => {
    let port: number;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const result = await setupFn();
      port = result.port;
      cleanup = result.cleanup;
    });

    afterAll(async () => {
      await cleanup();
    });

    for (const route of routes) {
      it(`${route} matches snapshot`, async () => {
        const actual = await createSnapshot(port, route);
        const expected = expectedSnapshots.get(route);

        if (expected) {
          assertSnapshotMatch(actual, expected);
        } else {
          console.log(`New snapshot for ${route}:`, JSON.stringify(actual, null, 2));
        }
      });
    }
  });
}
```

---

## 4. Test Environment Requirements

### 4.1 Global State Isolation

```typescript
// tests/setup/global-isolation.ts

/**
 * Global state that needs isolation between tests
 */
interface GlobalTestState {
  // Cache instances
  mdxRendererCache: Map<string, unknown>;
  transformCache: Map<string, unknown>;
  moduleCache: Map<string, unknown>;

  // Singletons
  esbuildInstance: unknown;
  reactInstance: unknown;

  // Environment
  originalEnv: Record<string, string | undefined>;
}

/**
 * Resets all global state between tests
 */
export async function resetGlobalState(): Promise<void> {
  // Reset MDX renderer cache
  try {
    const { clearMDXRendererCache } = await import(
      "@veryfront/build/transforms/mdx/index.ts"
    );
    clearMDXRendererCache();
  } catch {
    // Module may not be loaded
  }

  // Reset React cache
  try {
    const { resetReactCache } = await import(
      "@veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    resetReactCache();
  } catch {
    // Module may not be loaded
  }

  // Reset compat hooks
  try {
    const { resetCompatHooksContext } = await import(
      "@veryfront/react/compat/hooks-adapter.ts"
    );
    resetCompatHooksContext();
  } catch {
    // Module may not be loaded
  }

  // Clear bundler state
  try {
    const { cleanupBundler } = await import("@veryfront/rendering/cleanup.ts");
    await cleanupBundler();
  } catch {
    // Module may not be loaded
  }
}

/**
 * Creates an isolated test scope with automatic state reset
 */
export async function withIsolatedState<T>(
  fn: () => Promise<T>,
): Promise<T> {
  await resetGlobalState();
  try {
    return await fn();
  } finally {
    await resetGlobalState();
  }
}
```

### 4.2 Cache Reset Between Tests

```typescript
// tests/setup/cache-reset.ts

import { runWithCacheDir } from "@veryfront/utils/cache-dir.ts";

/**
 * Creates an isolated cache directory for a test
 */
export async function withIsolatedCache<T>(
  testName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const cacheDir = await Deno.makeTempDir({
    prefix: `veryfront_cache_${testName}_`,
  });

  try {
    return await runWithCacheDir(cacheDir, fn);
  } finally {
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Clears all caches for a specific project
 */
export async function clearProjectCaches(projectId: string): Promise<void> {
  // This would clear:
  // 1. File cache (FileCache instances)
  // 2. Module cache (ESM module cache)
  // 3. Transform cache (MDX/TSX transforms)
  // 4. Render cache (SSR output cache)

  // Implementation depends on cache registry
  const { clearProjectCache } = await import("@veryfront/cache");
  await clearProjectCache(projectId);
}
```

### 4.3 Environment Variable Simulation

```typescript
// tests/setup/env-simulation.ts

import { getEnv, setEnv, deleteEnv } from "@veryfront/platform/compat/process.ts";

/**
 * Environment presets for different test scenarios
 */
export const ENV_PRESETS = {
  development: {
    NODE_ENV: "development",
    PRODUCTION_MODE: "0",
    VF_DISABLE_LRU_INTERVAL: "1",
    LOG_FORMAT: "text",
  },
  production: {
    NODE_ENV: "production",
    PRODUCTION_MODE: "1",
    VF_DISABLE_LRU_INTERVAL: "1",
    LOG_FORMAT: "json",
  },
  test: {
    NODE_ENV: "test",
    VF_DISABLE_LRU_INTERVAL: "1",
    LOG_FORMAT: "text",
    DEBUG_TESTS: "1",
  },
  ci: {
    NODE_ENV: "production",
    CI: "true",
    VF_DISABLE_LRU_INTERVAL: "1",
    LOG_FORMAT: "text",
  },
} as const;

/**
 * Runs a function with specific environment variables
 */
export function withEnv<T>(
  vars: Record<string, string>,
  fn: () => T,
): T {
  const original: Record<string, string | undefined> = {};

  // Save originals and set new values
  for (const [key, value] of Object.entries(vars)) {
    original[key] = getEnv(key);
    setEnv(key, value);
  }

  try {
    return fn();
  } finally {
    // Restore originals
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  }
}

/**
 * Runs an async function with specific environment variables
 */
export async function withEnvAsync<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    original[key] = getEnv(key);
    setEnv(key, value);
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  }
}
```

### 4.4 Distributed Cache Testing (Local Simulation)

```typescript
// tests/setup/distributed-cache-simulation.ts

import { FileCache } from "@veryfront/platform/adapters/fs/cache/file-cache.ts";

/**
 * Simulates a distributed cache cluster for testing
 */
export class DistributedCacheSimulator {
  private nodes: Map<string, FileCache> = new Map();
  private primaryNode: string | null = null;

  constructor(nodeCount: number = 3) {
    for (let i = 0; i < nodeCount; i++) {
      const nodeId = `node-${i}`;
      this.nodes.set(nodeId, new FileCache({ maxSize: 1000, ttl: 60000 }));
      if (i === 0) this.primaryNode = nodeId;
    }
  }

  /**
   * Gets a value, simulating distributed lookup
   */
  async get(key: string): Promise<unknown | undefined> {
    // First check primary
    const primary = this.nodes.get(this.primaryNode!);
    const value = primary?.get(key);
    if (value !== undefined) return value;

    // Check other nodes (simulating network latency)
    for (const [nodeId, cache] of this.nodes) {
      if (nodeId === this.primaryNode) continue;

      await new Promise(r => setTimeout(r, Math.random() * 10)); // Simulate latency
      const nodeValue = cache.get(key);
      if (nodeValue !== undefined) {
        // Replicate to primary
        primary?.set(key, nodeValue);
        return nodeValue;
      }
    }

    return undefined;
  }

  /**
   * Sets a value, simulating distributed write
   */
  async set(key: string, value: unknown): Promise<void> {
    const primary = this.nodes.get(this.primaryNode!);
    primary?.set(key, value);

    // Async replication to other nodes
    for (const [nodeId, cache] of this.nodes) {
      if (nodeId === this.primaryNode) continue;

      // Simulate async replication with some delay
      setTimeout(() => {
        cache.set(key, value);
      }, Math.random() * 50);
    }
  }

  /**
   * Simulates node failure
   */
  failNode(nodeId: string): void {
    const cache = this.nodes.get(nodeId);
    cache?.clear();

    if (nodeId === this.primaryNode) {
      // Promote another node
      for (const id of this.nodes.keys()) {
        if (id !== nodeId) {
          this.primaryNode = id;
          break;
        }
      }
    }
  }

  /**
   * Gets cluster stats
   */
  getStats(): Record<string, { size: number; hitRate: number }> {
    const stats: Record<string, { size: number; hitRate: number }> = {};

    for (const [nodeId, cache] of this.nodes) {
      const cacheStats = cache.stats();
      stats[nodeId] = {
        size: cacheStats.size,
        hitRate: cacheStats.hitRate,
      };
    }

    return stats;
  }

  /**
   * Clears all nodes
   */
  clear(): void {
    for (const cache of this.nodes.values()) {
      cache.clear();
    }
  }
}
```

---

## 5. CI Pipeline Structure

### 5.1 Test Categorization

```yaml
# Tests are categorized by:
# - Speed: fast (<5s), medium (<30s), slow (>30s)
# - Scope: unit, integration, e2e
# - Stability: stable, flaky
# - Required: pr, nightly, release

test_categories:
  pr_required:
    - unit_tests
    - integration_tests_fast
    - lint_format_typecheck

  pr_optional:
    - cross_runtime_tests
    - performance_smoke_tests

  nightly:
    - all_unit_tests
    - all_integration_tests
    - e2e_tests
    - cross_runtime_full
    - performance_benchmarks
    - security_scans

  release:
    - all_tests
    - performance_regression
    - cross_adapter_consistency
    - multi_tenant_isolation
    - backward_compatibility
```

### 5.2 Enhanced CI Configuration

```yaml
# .github/workflows/ci-enhanced.yml (proposed)

name: CI/CD Enhanced

on:
  workflow_dispatch:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM UTC

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  VF_DISABLE_LRU_INTERVAL: "1"
  NODE_ENV: production
  LOG_FORMAT: text

jobs:
  # ============================================
  # QUALITY GATES (PR blocking)
  # ============================================

  format-lint-typecheck:
    runs-on: veryfront-k8s-runners
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - run: |
          deno fmt --check
          deno task lint
          deno task typecheck

  unit-tests:
    runs-on: veryfront-k8s-runners
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]  # Parallel shards for faster execution
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Unit Tests (Shard ${{ matrix.shard }})
        run: |
          deno task test:unit --shard=${{ matrix.shard }}/4

  integration-tests-fast:
    runs-on: veryfront-k8s-runners
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Fast Integration Tests
        run: |
          deno task test:integration --filter="fast"

  # ============================================
  # EXTENDED TESTS (PR optional, nightly required)
  # ============================================

  integration-tests-full:
    needs: [format-lint-typecheck, unit-tests]
    if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'run-full-tests')
    runs-on: veryfront-k8s-runners
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run All Integration Tests
        run: deno task test:integration

  cross-runtime-tests:
    needs: [format-lint-typecheck, unit-tests]
    if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'run-full-tests')
    runs-on: veryfront-k8s-runners
    continue-on-error: true
    strategy:
      fail-fast: false
      matrix:
        runtime: [node, bun]
    steps:
      - uses: actions/checkout@v4
      - name: Setup ${{ matrix.runtime }}
        uses: ${{ matrix.runtime == 'node' && 'actions/setup-node@v4' || 'oven-sh/setup-bun@v2' }}
        with:
          ${{ matrix.runtime }}-version: ${{ matrix.runtime == 'node' && '22' || 'latest' }}
      - name: Run Tests (${{ matrix.runtime }})
        run: |
          ${{ matrix.runtime == 'node' && 'node --experimental-transform-types --import ./scripts/node-resolver.mjs --test "src/**/*.test.ts"' || 'bun test src/' }}

  # ============================================
  # PERFORMANCE TESTS
  # ============================================

  performance-smoke:
    needs: [format-lint-typecheck]
    if: github.event_name == 'pull_request'
    runs-on: veryfront-k8s-runners
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Performance Smoke Tests
        run: deno task test:perf-smoke
      - name: Upload Performance Results
        uses: actions/upload-artifact@v4
        with:
          name: perf-smoke-results
          path: coverage/perf-smoke.json

  performance-benchmarks:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: veryfront-k8s-runners
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Performance Benchmarks
        run: deno task test:perf-benchmark
      - name: Compare with Baseline
        run: deno run -A scripts/compare-perf-baseline.ts
      - name: Upload Benchmark Results
        uses: actions/upload-artifact@v4
        with:
          name: perf-benchmark-results
          path: coverage/perf-benchmark.json

  # ============================================
  # MULTI-TENANT & ADAPTER TESTS (Nightly)
  # ============================================

  multi-tenant-tests:
    if: github.event_name == 'schedule'
    runs-on: veryfront-k8s-runners
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Multi-Tenant Isolation Tests
        run: deno task test:multi-tenant

  cross-adapter-tests:
    if: github.event_name == 'schedule'
    runs-on: veryfront-k8s-runners
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        adapter: [local, api, github]
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - name: Run Cross-Adapter Tests (${{ matrix.adapter }})
        run: deno task test:adapter --adapter=${{ matrix.adapter }}

  # ============================================
  # E2E TESTS (Nightly & Release)
  # ============================================

  e2e-tests:
    if: github.event_name == 'schedule' || github.ref == 'refs/heads/main'
    runs-on: veryfront-k8s-runners
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts
          cache: true
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Playwright
        run: npx playwright install --with-deps
      - name: Run E2E Tests
        run: deno task test:e2e
      - name: Upload E2E Artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          path: |
            tests/e2e/test-results/
            tests/e2e/playwright-report/

  # ============================================
  # SECURITY SCANS (Weekly)
  # ============================================

  security-scan:
    if: github.event_name == 'schedule' && github.event.schedule == '0 2 * * 0'  # Sunday only
    runs-on: veryfront-k8s-runners
    steps:
      - uses: actions/checkout@v4
      - name: Run Security Scan
        run: |
          # Dependency audit
          deno info --json > deps.json
          # Custom security checks
          deno run -A scripts/security-scan.ts

  # ============================================
  # BUILD & DEPLOY (unchanged from original)
  # ============================================

  build:
    needs: [format-lint-typecheck, unit-tests, integration-tests-fast]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    # ... (rest of build job unchanged)
```

### 5.3 Test Task Definitions

```json
// deno.json additions for test tasks
{
  "tasks": {
    "test:unit": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --parallel --allow-all '--ignore=tests,src/ai/workflow/__tests__,src/cli/commands/*.integration.test.ts'",
    "test:integration": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --parallel --allow-all tests",
    "test:integration:fast": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --parallel --allow-all tests --filter='(fast|smoke)'",

    "test:perf-smoke": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all tests/performance/smoke.test.ts",
    "test:perf-benchmark": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all tests/performance/benchmarks/",

    "test:multi-tenant": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all tests/integration/renderer/*isolation*.test.ts tests/integration/renderer/*tenant*.test.ts",
    "test:adapter": "VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all tests/integration/adapters/",

    "test:e2e": "npx playwright test --config=tests/e2e/playwright.config.ts",

    "test:coverage:all": "rm -rf coverage && VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --parallel --fail-fast --allow-all --coverage=coverage",
    "test:coverage:report": "deno coverage coverage --lcov > coverage/lcov.info"
  }
}
```

---

## 6. Performance Benchmark Requirements

### 6.1 Performance Test Suite

```typescript
// tests/performance/benchmarks/ssr-rendering.bench.ts

import { assertEquals } from "@veryfront/testing/assert";
import { withTestContext } from "../../_helpers/context.ts";
import { measurePerformance, assertWithinBudget } from "../../utilities/perf-utils.ts";
import { PROJECT_FIXTURES, createProjectFixture } from "../../fixtures/project-fixtures.ts";

/**
 * SSR Rendering Performance Benchmarks
 */
Deno.test({
  name: "Performance: SSR render time for minimal page",
  fn: async () => {
    await withTestContext("perf-ssr-minimal", async (context) => {
      await createProjectFixture(context.projectDir, "minimal");
      const server = await context.createDevServer();

      const metrics = await measurePerformance(async () => {
        const response = await fetch(`http://localhost:${server.port}/`);
        await response.text();
      }, 50, 5);

      assertWithinBudget(metrics, "SSR_RENDER");

      console.log(`SSR Minimal Page: median=${metrics.median.toFixed(2)}ms, p95=${metrics.p95.toFixed(2)}ms`);
    });
  },
});

Deno.test({
  name: "Performance: SSR render time for full-stack page",
  fn: async () => {
    await withTestContext("perf-ssr-fullstack", async (context) => {
      await createProjectFixture(context.projectDir, "fullStack");
      const server = await context.createDevServer();

      const metrics = await measurePerformance(async () => {
        const response = await fetch(`http://localhost:${server.port}/`);
        await response.text();
      }, 50, 5);

      // Full stack pages have higher budget
      assertEquals(metrics.p95 < 500, true, `SSR too slow: ${metrics.p95}ms`);

      console.log(`SSR Full-Stack Page: median=${metrics.median.toFixed(2)}ms, p95=${metrics.p95.toFixed(2)}ms`);
    });
  },
});

Deno.test({
  name: "Performance: Cache hit response time",
  fn: async () => {
    await withTestContext("perf-cache-hit", async (context) => {
      await createProjectFixture(context.projectDir, "minimal");
      const server = await context.createDevServer();

      // Warm up cache
      for (let i = 0; i < 5; i++) {
        await fetch(`http://localhost:${server.port}/`);
      }

      const metrics = await measurePerformance(async () => {
        const response = await fetch(`http://localhost:${server.port}/`);
        await response.text();
      }, 100, 0); // No warmup needed

      assertWithinBudget(metrics, "CACHE_HIT");

      console.log(`Cache Hit: median=${metrics.median.toFixed(2)}ms, p95=${metrics.p95.toFixed(2)}ms`);
    });
  },
});

Deno.test({
  name: "Performance: API route response time",
  fn: async () => {
    await withTestContext("perf-api-route", async (context) => {
      await createProjectFixture(context.projectDir, "api");
      const server = await context.createDevServer();

      const metrics = await measurePerformance(async () => {
        const response = await fetch(`http://localhost:${server.port}/api/health`);
        await response.json();
      }, 100, 5);

      assertWithinBudget(metrics, "API_RESPONSE");

      console.log(`API Route: median=${metrics.median.toFixed(2)}ms, p95=${metrics.p95.toFixed(2)}ms`);
    });
  },
});
```

### 6.2 Performance Baseline Comparison

```typescript
// scripts/compare-perf-baseline.ts

interface PerfBaseline {
  ssr_minimal_p95: number;
  ssr_fullstack_p95: number;
  cache_hit_p95: number;
  api_route_p95: number;
  timestamp: string;
  commit: string;
}

const REGRESSION_THRESHOLD = 0.1; // 10% regression threshold

async function main() {
  // Load current results
  const currentResults = JSON.parse(
    await Deno.readTextFile("coverage/perf-benchmark.json"),
  );

  // Load baseline (stored in repo or fetched from artifact storage)
  let baseline: PerfBaseline;
  try {
    baseline = JSON.parse(
      await Deno.readTextFile("tests/performance/baseline.json"),
    );
  } catch {
    console.log("No baseline found, creating initial baseline");
    await Deno.writeTextFile(
      "tests/performance/baseline.json",
      JSON.stringify(currentResults, null, 2),
    );
    return;
  }

  // Compare each metric
  const regressions: string[] = [];

  for (const [metric, currentValue] of Object.entries(currentResults)) {
    if (metric === "timestamp" || metric === "commit") continue;

    const baselineValue = baseline[metric as keyof PerfBaseline] as number;
    if (typeof baselineValue !== "number") continue;

    const change = (currentValue as number - baselineValue) / baselineValue;

    if (change > REGRESSION_THRESHOLD) {
      regressions.push(
        `${metric}: ${baselineValue.toFixed(2)}ms -> ${(currentValue as number).toFixed(2)}ms ` +
        `(+${(change * 100).toFixed(1)}%)`,
      );
    }
  }

  if (regressions.length > 0) {
    console.error("Performance regressions detected:");
    for (const regression of regressions) {
      console.error(`  - ${regression}`);
    }
    Deno.exit(1);
  }

  console.log("No significant performance regressions detected");
}

main();
```

---

## Summary

This specification provides:

1. **Test Fixtures**: Pre-built project templates and adapter configurations for consistent testing
2. **Test Utilities**: Reusable functions for rendering, caching, and performance testing
3. **Test Patterns**: Cross-adapter consistency, multi-tenant isolation, cache comparison, deployment mode, and regression testing patterns
4. **Environment Requirements**: Global state isolation, cache reset, environment simulation, and distributed cache testing
5. **CI Pipeline Structure**: Categorized tests with appropriate gates for PR, nightly, and release workflows
6. **Performance Benchmarks**: Structured performance testing with baseline comparison

The infrastructure is designed to:
- Run quickly on PRs (fast tests only)
- Ensure comprehensive coverage nightly
- Validate performance regressions before release
- Support cross-runtime testing (Deno, Node, Bun)
- Enable multi-tenant isolation testing
- Provide clear test patterns for contributors
