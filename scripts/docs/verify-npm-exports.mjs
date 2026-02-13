#!/usr/bin/env node
/**
 * Verify that all documented exports resolve from the built npm package.
 *
 * 1. Dynamically imports every top-level export path from npm/
 * 2. Checks that key named exports exist (from the DESCRIPTIONS map)
 * 3. Reports missing or broken exports
 *
 * Usage: node scripts/docs/verify-npm-exports.mjs
 *   (run after `deno task build:npm`)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NPM_DIR = resolve(ROOT, "npm");

// Read deno.json to get export paths
const denoConfig = JSON.parse(readFileSync(resolve(ROOT, "deno.json"), "utf8"));
const exports = denoConfig.exports ?? {};

// Top-level export paths only (no sub-paths like ./workflow/worker)
const topLevelExports = Object.keys(exports).filter((p) => {
  const parts = p.split("/");
  return parts.length <= 2;
});

// Key named exports per module that MUST exist (subset — the most important ones)
const REQUIRED_EXPORTS = {
  ".": ["defineConfig", "json", "notFound", "redirect", "getEnv", "createValidatedHandler", "startServer", "createHandler"],
  "./head": ["Head"],
  "./router": ["Link", "useRouter", "RouterProvider"],
  "./context": ["usePageContext", "PageContextProvider"],
  "./fonts": ["GoogleFonts"],
  "./chat": ["Chat", "useChat", "useAgent", "AgentCard", "Message", "AIErrorBoundary"],
  "./markdown": ["Markdown"],
  "./mdx": ["MDXProvider", "useMDXComponents"],
  "./agent": ["agent", "AgentRuntime", "registerAgent", "getAgentsAsTools", "agentAsTool", "createMemory"],
  "./tool": ["tool", "dynamicTool", "executeTool", "toolRegistry"],
  "./workflow": ["workflow", "step", "parallel", "branch", "dag", "waitForApproval", "createWorkflowClient"],
  "./prompt": ["prompt", "promptRegistry"],
  "./resource": ["resource", "resourceRegistry"],
  "./mcp": ["createMCPServer", "registerTool", "registerPrompt", "registerResource"],
  "./middleware": ["cors", "rateLimit", "logger", "timeout", "MiddlewarePipeline"],
  "./oauth": ["createOAuthInitHandler", "createOAuthCallbackHandler", "githubConfig", "slackConfig", "MemoryTokenStore"],
  "./provider": ["registerModelProvider", "resolveModel", "hasModelProvider", "getRegisteredModelProviders"],
  "./fs": ["readTextFile", "writeTextFile", "join", "resolve", "exists", "mkdir"],
};

let passed = 0;
let failed = 0;
const errors = [];

for (const exportPath of topLevelExports) {
  const importPath = resolve(NPM_DIR, "esm", exports[exportPath].replace(/\.tsx?$/, ".js"));
  const label = exportPath === "." ? "veryfront" : `veryfront/${exportPath.replace("./", "")}`;

  try {
    const mod = await import(importPath);
    const exportNames = Object.keys(mod);

    // Check required exports exist
    const required = REQUIRED_EXPORTS[exportPath] ?? [];
    const missing = required.filter((name) => !exportNames.includes(name));

    if (missing.length > 0) {
      failed++;
      errors.push(`  ${label}: missing exports: ${missing.join(", ")}`);
      console.log(`  FAIL  ${label} — missing: ${missing.join(", ")}`);
    } else {
      passed++;
      console.log(`  OK    ${label} (${exportNames.length} exports)`);
    }
  } catch (err) {
    failed++;
    const msg = err.message?.split("\n")[0] ?? String(err);
    errors.push(`  ${label}: import failed — ${msg}`);
    console.log(`  FAIL  ${label} — ${msg}`);
  }
}

console.log();
console.log(`${passed} passed, ${failed} failed out of ${topLevelExports.length} export paths`);

if (errors.length > 0) {
  console.log("\nErrors:");
  for (const e of errors) console.log(e);
  process.exit(1);
}
