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

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NPM_DIR = resolve(ROOT, "npm");

// Read deno.json to get export paths
const denoConfig = JSON.parse(readFileSync(resolve(ROOT, "deno.json"), "utf8"));
const exports = denoConfig.exports ?? {};
const npmPackage = JSON.parse(readFileSync(resolve(NPM_DIR, "package.json"), "utf8"));
const npmExports = npmPackage.exports ?? {};

// Top-level module export paths only (no sub-paths like ./workflow/worker)
// Skip executable/assets surfaces that are verified separately.
const moduleExports = Object.keys(exports).filter((p) => {
  const parts = p.split("/");
  return parts.length <= 2 && p !== "./cli" && p !== "./tsconfig.json";
});

const CLI_EXPORT = "./cli";

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
  "./agent": [
    "agent",
    "AgentRuntime",
    "RunResumeSessionManager",
    "createAgUiHandler",
    "waitForHumanInput",
    "HumanInputRequestSchema",
    "registerAgent",
    "getAgentsAsTools",
    "agentAsTool",
    "createMemory",
  ],
  "./tool": ["tool", "dynamicTool", "executeTool", "toolRegistry", "createRemoteMCPToolSource"],
  "./workflow": ["workflow", "step", "parallel", "branch", "dag", "waitForApproval", "createWorkflowClient"],
  "./prompt": ["prompt", "promptRegistry"],
  "./resource": ["resource", "resourceRegistry"],
  "./mcp": ["createMCPServer", "registerTool", "registerPrompt", "registerResource"],
  "./middleware": ["cors", "rateLimit", "logger", "timeout", "MiddlewarePipeline"],
  "./oauth": ["createOAuthInitHandler", "createOAuthCallbackHandler", "githubConfig", "slackConfig", "MemoryTokenStore"],
  "./provider": [
    "registerModelProvider",
    "resolveModel",
    "hasModelProvider",
    "getRegisteredModelProviders",
    "runWithVeryfrontCloudContext",
    "runWithVeryfrontCloudContextAsync",
  ],
  "./fs": ["readTextFile", "writeTextFile", "join", "resolve", "exists", "mkdir"],
};

let passed = 0;
let failed = 0;
const errors = [];

for (const exportPath of moduleExports) {
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

const cliEntry = npmExports[CLI_EXPORT];
if (!cliEntry) {
  failed++;
  const label = "veryfront/cli";
  errors.push(`  ${label}: missing export map entry`);
  console.log(`  FAIL  ${label} — missing export map entry`);
} else {
  const cliImportTarget = typeof cliEntry === "string" ? cliEntry : cliEntry.import;
  const cliImportPath = resolve(NPM_DIR, cliImportTarget);
  const cliBinPath = resolve(NPM_DIR, "bin/veryfront.js");

  if (!existsSync(cliImportPath)) {
    failed++;
    errors.push(`  veryfront/cli: missing import target ${cliImportTarget}`);
    console.log(`  FAIL  veryfront/cli — missing import target ${cliImportTarget}`);
  } else if (!existsSync(cliBinPath)) {
    failed++;
    errors.push("  veryfront/cli: missing npm bin/veryfront.js");
    console.log("  FAIL  veryfront/cli — missing npm bin/veryfront.js");
  } else {
    passed++;
    console.log("  OK    veryfront/cli (entrypoints exist)");
  }
}

console.log();
console.log(`${passed} passed, ${failed} failed out of ${moduleExports.length + 1} export paths`);

if (errors.length > 0) {
  console.log("\nErrors:");
  for (const e of errors) console.log(e);
  process.exit(1);
}

process.exit(0);
