#!/usr/bin/env node
/**
 * End-to-end Node.js smoke test for the built npm package.
 *
 * Imports every public module, verifies key exports exist and are the right
 * type (function, class, etc.), and runs basic sanity checks where possible.
 *
 * Usage: node scripts/docs/verify-npm-node.mjs
 *   (run after `deno task build:npm`)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NPM = resolve(ROOT, "npm");

// Read npm package.json to get export map
const npmPkg = JSON.parse(readFileSync(resolve(NPM, "package.json"), "utf8"));
const npmExports = npmPkg.exports ?? {};

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function assertType(value, expectedType, label) {
  assert(typeof value === expectedType, `${label} — expected ${expectedType}, got ${typeof value}`);
}

// Helper to import from npm package using the actual export map
async function imp(exportPath) {
  const entry = npmExports[exportPath];
  if (!entry) throw new Error(`No export for "${exportPath}" in npm/package.json`);
  const jsPath = resolve(NPM, typeof entry === "string" ? entry : entry.import);
  return import(jsPath);
}

console.log("Node.js npm package smoke test\n");
console.log(`Node ${process.version}`);
console.log(`Package: ${NPM}\n`);

// --- Root module ---
console.log("veryfront (root):");
try {
  const root = await imp(".");
  assertType(root.defineConfig, "function", "defineConfig is function");
  assertType(root.json, "function", "json is function");
  assertType(root.notFound, "function", "notFound is function");
  assertType(root.redirect, "function", "redirect is function");
  assertType(root.getEnv, "function", "getEnv is function");

  // Sanity: json() should return a Response-like object
  const resp = root.json({ ok: true });
  assert(resp?.headers?.get !== undefined, "json() returns Response-like");
  assert(resp.headers.get("content-type")?.includes("application/json"), "json() sets content-type");
  const body = await resp.json();
  assert(body.ok === true, "json() body is correct");
  console.log("  OK    root — 8 checks");
} catch (err) {
  failed++;
  errors.push(`root: ${err.message}`);
  console.log(`  FAIL  root — ${err.message}`);
}

// --- Router ---
console.log("veryfront/router:");
try {
  const router = await imp("./router");
  assertType(router.useRouter, "function", "useRouter is function");
  assert(router.Link !== undefined, "Link exists");
  assert(router.RouterProvider !== undefined, "RouterProvider exists");
  console.log("  OK    router — 3 checks");
} catch (err) {
  failed++;
  errors.push(`router: ${err.message}`);
  console.log(`  FAIL  router — ${err.message}`);
}

// --- Agent ---
console.log("veryfront/agent:");
try {
  const agentMod = await imp("./agent");
  assertType(agentMod.agent, "function", "agent() is function");
  assertType(agentMod.registerAgent, "function", "registerAgent is function");
  assertType(agentMod.getAgentsAsTools, "function", "getAgentsAsTools is function");
  assertType(agentMod.agentAsTool, "function", "agentAsTool is function");
  assertType(agentMod.createMemory, "function", "createMemory is function");
  assert(agentMod.AgentRuntime !== undefined, "AgentRuntime exists");
  console.log("  OK    agent — 6 checks");
} catch (err) {
  failed++;
  errors.push(`agent: ${err.message}`);
  console.log(`  FAIL  agent — ${err.message}`);
}

// --- Tool ---
console.log("veryfront/tool:");
try {
  const toolMod = await imp("./tool");
  assertType(toolMod.tool, "function", "tool() is function");
  assertType(toolMod.dynamicTool, "function", "dynamicTool is function");
  assertType(toolMod.executeTool, "function", "executeTool is function");
  assert(toolMod.toolRegistry !== undefined, "toolRegistry exists");

  // Sanity: create a tool and verify it has the right shape
  const { z } = await import(resolve(NPM, "node_modules/zod/index.cjs"));
  const testTool = toolMod.tool({
    id: "test-tool",
    description: "A test tool",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => ({ result: query }),
  });
  assert(testTool.id === "test-tool", "tool().id is correct");
  assert(testTool.description === "A test tool", "tool().description is correct");
  assertType(testTool.execute, "function", "tool().execute is function");

  // Execute the tool
  const result = await testTool.execute({ query: "hello" });
  assert(result.result === "hello", "tool execute returns correct result");
  console.log("  OK    tool — 8 checks");
} catch (err) {
  failed++;
  errors.push(`tool: ${err.message}`);
  console.log(`  FAIL  tool — ${err.message}`);
}

// --- Chat ---
console.log("veryfront/chat:");
try {
  const chat = await imp("./chat");
  assert(chat.Chat !== undefined, "Chat exists");
  assert(chat.useChat !== undefined, "useChat exists");
  assert(chat.useAgent !== undefined, "useAgent exists");
  assert(chat.AgentCard !== undefined, "AgentCard exists");
  assert(chat.Message !== undefined, "Message exists");
  assert(chat.AIErrorBoundary !== undefined, "AIErrorBoundary exists");
  console.log("  OK    chat — 6 checks");
} catch (err) {
  failed++;
  errors.push(`chat: ${err.message}`);
  console.log(`  FAIL  chat — ${err.message}`);
}

// --- Workflow ---
console.log("veryfront/workflow:");
try {
  const wf = await imp("./workflow");
  assertType(wf.workflow, "function", "workflow is function");
  assertType(wf.step, "function", "step is function");
  assertType(wf.parallel, "function", "parallel is function");
  assertType(wf.branch, "function", "branch is function");
  assertType(wf.dag, "function", "dag is function");
  console.log("  OK    workflow — 5 checks");
} catch (err) {
  failed++;
  errors.push(`workflow: ${err.message}`);
  console.log(`  FAIL  workflow — ${err.message}`);
}

// --- Provider ---
console.log("veryfront/provider:");
try {
  const prov = await imp("./provider");
  assertType(prov.registerModelProvider, "function", "registerModelProvider is function");
  assertType(prov.resolveModel, "function", "resolveModel is function");
  assertType(prov.hasModelProvider, "function", "hasModelProvider is function");
  assertType(prov.getRegisteredModelProviders, "function", "getRegisteredModelProviders is function");
  assertType(prov.clearModelProviders, "function", "clearModelProviders is function");
  console.log("  OK    provider — 5 checks");
} catch (err) {
  failed++;
  errors.push(`provider: ${err.message}`);
  console.log(`  FAIL  provider — ${err.message}`);
}

// --- MCP ---
console.log("veryfront/mcp:");
try {
  const mcp = await imp("./mcp");
  assertType(mcp.createMCPServer, "function", "createMCPServer is function");
  assertType(mcp.registerTool, "function", "registerTool is function");
  assertType(mcp.registerPrompt, "function", "registerPrompt is function");
  assertType(mcp.registerResource, "function", "registerResource is function");
  console.log("  OK    mcp — 4 checks");
} catch (err) {
  failed++;
  errors.push(`mcp: ${err.message}`);
  console.log(`  FAIL  mcp — ${err.message}`);
}

// --- Middleware ---
console.log("veryfront/middleware:");
try {
  const mw = await imp("./middleware");
  assertType(mw.cors, "function", "cors is function");
  assertType(mw.rateLimit, "function", "rateLimit is function");
  assertType(mw.logger, "function", "logger is function");
  assertType(mw.timeout, "function", "timeout is function");
  assert(mw.MiddlewarePipeline !== undefined, "MiddlewarePipeline exists");

  // Sanity: create a pipeline
  const pipeline = new mw.MiddlewarePipeline();
  assert(pipeline instanceof mw.MiddlewarePipeline, "MiddlewarePipeline instantiates");
  console.log("  OK    middleware — 6 checks");
} catch (err) {
  failed++;
  errors.push(`middleware: ${err.message}`);
  console.log(`  FAIL  middleware — ${err.message}`);
}

// --- OAuth ---
console.log("veryfront/oauth:");
try {
  const oauth = await imp("./oauth");
  assertType(oauth.createOAuthInitHandler, "function", "createOAuthInitHandler is function");
  assertType(oauth.createOAuthCallbackHandler, "function", "createOAuthCallbackHandler is function");
  assert(oauth.githubConfig !== undefined, "githubConfig exists");
  assert(oauth.slackConfig !== undefined, "slackConfig exists");
  assert(oauth.MemoryTokenStore !== undefined, "MemoryTokenStore exists");
  console.log("  OK    oauth — 5 checks");
} catch (err) {
  failed++;
  errors.push(`oauth: ${err.message}`);
  console.log(`  FAIL  oauth — ${err.message}`);
}

// --- FS ---
console.log("veryfront/fs:");
try {
  const fs = await imp("./fs");
  assertType(fs.readTextFile, "function", "readTextFile is function");
  assertType(fs.writeTextFile, "function", "writeTextFile is function");
  assertType(fs.join, "function", "join is function");
  assertType(fs.resolve, "function", "resolve is function");
  assertType(fs.exists, "function", "exists is function");
  assertType(fs.mkdir, "function", "mkdir is function");

  // Sanity: join() should join paths
  const joined = fs.join("foo", "bar", "baz.ts");
  assert(joined === "foo/bar/baz.ts" || joined === "foo\\bar\\baz.ts", "join() works");
  console.log("  OK    fs — 7 checks");
} catch (err) {
  failed++;
  errors.push(`fs: ${err.message}`);
  console.log(`  FAIL  fs — ${err.message}`);
}

// --- Prompt ---
console.log("veryfront/prompt:");
try {
  const promptMod = await imp("./prompt");
  assertType(promptMod.prompt, "function", "prompt is function");
  assert(promptMod.promptRegistry !== undefined, "promptRegistry exists");
  console.log("  OK    prompt — 2 checks");
} catch (err) {
  failed++;
  errors.push(`prompt: ${err.message}`);
  console.log(`  FAIL  prompt — ${err.message}`);
}

// --- Resource ---
console.log("veryfront/resource:");
try {
  const resMod = await imp("./resource");
  assertType(resMod.resource, "function", "resource is function");
  assert(resMod.resourceRegistry !== undefined, "resourceRegistry exists");
  console.log("  OK    resource — 2 checks");
} catch (err) {
  failed++;
  errors.push(`resource: ${err.message}`);
  console.log(`  FAIL  resource — ${err.message}`);
}

// --- Head ---
console.log("veryfront/head:");
try {
  const head = await imp("./head");
  assert(head.Head !== undefined, "Head exists");
  console.log("  OK    head — 1 check");
} catch (err) {
  failed++;
  errors.push(`head: ${err.message}`);
  console.log(`  FAIL  head — ${err.message}`);
}

// --- Markdown ---
console.log("veryfront/markdown:");
try {
  const md = await imp("./markdown");
  assert(md.Markdown !== undefined, "Markdown exists");
  console.log("  OK    markdown — 1 check");
} catch (err) {
  failed++;
  errors.push(`markdown: ${err.message}`);
  console.log(`  FAIL  markdown — ${err.message}`);
}

// --- MDX ---
console.log("veryfront/mdx:");
try {
  const mdx = await imp("./mdx");
  assert(mdx.MDXProvider !== undefined, "MDXProvider exists");
  assert(mdx.useMDXComponents !== undefined, "useMDXComponents exists");
  console.log("  OK    mdx — 2 checks");
} catch (err) {
  failed++;
  errors.push(`mdx: ${err.message}`);
  console.log(`  FAIL  mdx — ${err.message}`);
}

// --- Fonts ---
console.log("veryfront/fonts:");
try {
  const fonts = await imp("./fonts");
  assert(fonts.GoogleFonts !== undefined, "GoogleFonts exists");
  console.log("  OK    fonts — 1 check");
} catch (err) {
  failed++;
  errors.push(`fonts: ${err.message}`);
  console.log(`  FAIL  fonts — ${err.message}`);
}

// --- Context ---
console.log("veryfront/context:");
try {
  const ctx = await imp("./context");
  assert(ctx.usePageContext !== undefined, "usePageContext exists");
  assert(ctx.PageContextProvider !== undefined, "PageContextProvider exists");
  console.log("  OK    context — 2 checks");
} catch (err) {
  failed++;
  errors.push(`context: ${err.message}`);
  console.log(`  FAIL  context — ${err.message}`);
}

// --- Summary ---
console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed (${passed + failed} total checks across 18 modules)`);

if (errors.length > 0) {
  console.log("\nFailures:");
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
