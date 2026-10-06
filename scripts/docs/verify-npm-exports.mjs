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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_SAFE_CLIENT_MODULES, BROWSER_SAFE_EXPORTS, BROWSER_SAFE_TRANSITIVE_EXPORTS } from "../build/browser-safe-exports.mjs";

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
  "./ui": ["Button", "AppShell", "DesignTokenStyle", "generateTokenCSS"],
  "./chat": ["Chat", "useChat", "useAgent", "AgentCard", "Message", "ChatErrorBoundary"],
  "./markdown": ["Markdown"],
  "./mdx": ["MDXProvider", "useMDXComponents"],
  "./agent": [
    "agent",
    "AgentRuntime",
    "RunResumeSessionManager",
    "createAgUiHandler",
    "waitForHumanInput",
    "getHumanInputRequestSchema",
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
  ],
  "./fs": ["readTextFile", "writeTextFile", "join", "resolve", "exists", "mkdir"],
};

let passed = 0;
let failed = 0;

const IMPORT_SPECIFIER_PATTERN = /(?:import|export)\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;

function moduleSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

function resolveRelativeBuiltImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const withoutQuery = specifier.split("?")[0];
  const base = resolve(dirname(fromFile), withoutQuery);
  const candidates = /\.[cm]?js$/.test(base) ? [base] : [base, `${base}.js`, join(base, "index.js")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectTransitiveDntImporters(entryFile) {
  const queue = [entryFile];
  const visited = new Set();
  const importers = new Set();

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!file.startsWith(resolve(NPM_DIR, "esm")) || !existsSync(file)) continue;

    const content = readFileSync(file, "utf8");
    if (content.includes("_dnt.polyfills.js") || content.includes("_dnt.shims.js")) {
      importers.add(file);
    }

    for (const specifier of moduleSpecifiers(content)) {
      const target = resolveRelativeBuiltImport(file, specifier);
      if (target && !visited.has(target)) {
        queue.push(target);
      }
    }
  }

  return [...importers].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

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

for (const exportPath of BROWSER_SAFE_EXPORTS) {
  const target = exports[exportPath];
  const label = `veryfront/${exportPath.replace("./", "")}`;

  if (!target) {
    failed++;
    errors.push(`  ${label}: missing deno.json export entry`);
    console.log(`  FAIL  ${label} — missing deno.json export entry`);
    continue;
  }

  const builtFile = resolve(NPM_DIR, "esm", target.replace(/\.tsx?$/, ".js"));
  if (!existsSync(builtFile)) {
    failed++;
    errors.push(`  ${label}: missing built file ${builtFile}`);
    console.log(`  FAIL  ${label} — missing built file`);
    continue;
  }

  const content = readFileSync(builtFile, "utf8");
  if (content.includes('_dnt.polyfills.js') || content.includes('_dnt.shims.js')) {
    failed++;
    errors.push(`  ${label}: should not import dnt shim/polyfill`);
    console.log(`  FAIL  ${label} — still imports dnt shim/polyfill`);
    continue;
  }

  if (BROWSER_SAFE_TRANSITIVE_EXPORTS.includes(exportPath)) {
    const transitiveDntImporters = collectTransitiveDntImporters(builtFile);
    if (transitiveDntImporters.length > 0) {
      failed++;
      const relativeImporters = transitiveDntImporters.map((file) => file.replace(`${resolve(NPM_DIR, "esm")}/`, ""));
      errors.push(`  ${label}: transitive browser graph imports dnt shim/polyfill via ${relativeImporters.join(", ")}`);
      console.log(`  FAIL  ${label} — transitive graph imports dnt shim/polyfill`);
      continue;
    }
  }

  passed++;
  console.log(`  OK    ${label} (browser-safe entry)`);
}

for (const relativePath of BROWSER_SAFE_CLIENT_MODULES) {
  const builtFile = resolve(NPM_DIR, "esm", relativePath);
  const label = `veryfront/${relativePath}`;

  if (!existsSync(builtFile)) {
    failed++;
    errors.push(`  ${label}: missing built file ${builtFile}`);
    console.log(`  FAIL  ${label} — missing built file`);
    continue;
  }

  const content = readFileSync(builtFile, "utf8");
  if (content.includes("_dnt.shims.js")) {
    failed++;
    errors.push(`  ${label}: should not import _dnt.shims.js`);
    console.log(`  FAIL  ${label} — still imports _dnt.shims.js`);
    continue;
  }

  passed++;
  console.log(`  OK    ${label} (browser-safe module)`);
}

console.log();
console.log(
  `${passed} passed, ${failed} failed out of ${
    moduleExports.length + 1 + BROWSER_SAFE_EXPORTS.length + BROWSER_SAFE_CLIENT_MODULES.length
  } export paths`,
);

if (errors.length > 0) {
  console.log("\nErrors:");
  for (const e of errors) console.log(e);
  process.exit(1);
}

process.exit(0);
