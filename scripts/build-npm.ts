/**
 * Build script for publishing Veryfront to npm
 *
 * Uses esbuild + TypeScript to create npm-compatible package with:
 * - ESM output for modern bundlers
 * - TypeScript declaration files
 * - Proper exports map
 *
 * Usage:
 *   deno run -A scripts/build-npm.ts
 *
 * Test locally:
 *   cd npm && npm link
 *   cd /path/to/test-project && npm link veryfront
 */

import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
import { ensureDir, copy } from "https://deno.land/std@0.220.0/fs/mod.ts";
import { join, dirname, basename, relative, resolve, fromFileUrl } from "https://deno.land/std@0.220.0/path/mod.ts";

// Get the absolute path to the project root
const __dirname = dirname(fromFileUrl(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// Get version and imports from deno.json
const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = denoJson.version || "0.1.0";
const denoImports: Record<string, string> = denoJson.imports || {};

// Build the @veryfront import map with absolute paths
const veryfrontImportMap: Record<string, string> = {};
for (const [key, value] of Object.entries(denoImports)) {
  if (key.startsWith("@veryfront") && typeof value === "string" && value.startsWith("./")) {
    veryfrontImportMap[key] = resolve(PROJECT_ROOT, value);
  }
}

const OUT_DIR = "./npm";

console.log(`\n📦 Building Veryfront v${version} for npm...\n`);

// Clean and create output directory
try {
  await Deno.remove(OUT_DIR, { recursive: true });
} catch {
  // Directory doesn't exist
}
await ensureDir(OUT_DIR);
await ensureDir(join(OUT_DIR, "dist"));

// Entry points to build
// Start with the core AI functionality - most valuable for npm users
const entryPoints: Record<string, string> = {
  // AI - the primary value for npm users
  "ai/index": "./src/ai/index.ts",
  "ai/client": "./src/ai/client.ts",
  "ai/react": "./src/ai/react/index.ts",
  "ai/primitives": "./src/ai/react/primitives/index.ts",
  "ai/components": "./src/ai/react/components/index.ts",
  "ai/production": "./src/ai/production/index.ts",
  "ai/dev": "./src/ai/dev/index.ts",
  // Note: workflow has redis dependency issues, skip for now
  // "ai/workflow": "./src/ai/workflow/index.ts",
  // "ai/workflow/react": "./src/ai/workflow/react/index.ts",

  // Config - useful standalone
  "config": "./src/core/config/index.ts",

  // Data fetching
  "data": "./src/data/index.ts",

  // Components
  "components": "./src/react/components/index.ts",

  // Main entry (simplified)
  "index": "./src/index.ts",

  // Note: CLI is built separately as unbundled files (see below)
};

// Import mappings: Deno URLs -> npm packages
const importMappings: Record<string, string> = {
  // React
  "https://esm.sh/react@18.3.1": "react",
  "https://esm.sh/react-dom@18.3.1": "react-dom",
  "https://esm.sh/react-dom@18.3.1/server": "react-dom/server",
  "https://esm.sh/react-dom@18.3.1/client": "react-dom/client",
  "https://esm.sh/react@18.3.1/jsx-runtime": "react/jsx-runtime",
  "https://esm.sh/react@18.3.1/jsx-dev-runtime": "react/jsx-dev-runtime",
  // AI SDK
  "https://esm.sh/ai@5.0.76": "ai",
  "https://esm.sh/@ai-sdk/react@2.0.59": "@ai-sdk/react",
  "https://esm.sh/@ai-sdk/openai@2.0.1": "@ai-sdk/openai",
  "https://esm.sh/@ai-sdk/anthropic@2.0.4": "@ai-sdk/anthropic",
  // Zod
  "https://esm.sh/zod@3.22.0": "zod",
  // MDX
  "https://esm.sh/@mdx-js/mdx@3.0.0?deps=react@18.3.1,react-dom@18.3.1": "@mdx-js/mdx",
  "https://esm.sh/@mdx-js/react@3.0.0?deps=react@18.3.1,react-dom@18.3.1": "@mdx-js/react",
  // Remark/Rehype
  "https://esm.sh/remark-gfm@4.0.1": "remark-gfm",
  "https://esm.sh/remark-frontmatter@5.0.0": "remark-frontmatter",
  "https://esm.sh/rehype-highlight@7.0.2": "rehype-highlight",
  "https://esm.sh/rehype-slug@6.0.0": "rehype-slug",
  // Utilities
  "https://esm.sh/unist-util-visit@5.0.0": "unist-util-visit",
  "https://esm.sh/mdast-util-to-string@4.0.0": "mdast-util-to-string",
  "https://esm.sh/github-slugger@2.0.0": "github-slugger",
  "https://esm.sh/mime-types@2.1.35": "mime-types",
  "https://esm.sh/unified@11.0.5?dts": "unified",
  // Types
  "https://esm.sh/@types/mdast@4.0.3": "@types/mdast",
  "https://esm.sh/@types/hast@3.0.3": "@types/hast",
  "https://esm.sh/@types/unist@3.0.2": "@types/unist",
  "https://esm.sh/csstype@3.2.3": "csstype",
  // esbuild
  "https://deno.land/x/esbuild@v0.20.1/wasm.js": "esbuild",
  "https://deno.land/x/esbuild@v0.20.1/mod.js": "esbuild",
  // UnoCSS
  "https://esm.sh/unocss@0.59.0": "unocss",
  "https://esm.sh/@unocss/core@0.59.0": "@unocss/core",
  "https://esm.sh/@unocss/preset-wind@0.59.0": "@unocss/preset-wind",
};

// Create esbuild plugin for import rewriting
const denoResolvePlugin: esbuild.Plugin = {
  name: "deno-resolve",
  setup(build) {
    // Handle npm: prefixed imports (Deno style)
    build.onResolve({ filter: /^npm:/ }, (args) => {
      // npm:@opentelemetry/api@1 -> @opentelemetry/api
      const npmPkg = args.path.replace(/^npm:/, "").replace(/@[\d.]+$/, "");
      return { path: npmPkg, external: true };
    });

    // Handle Deno std library imports (std/ prefix from import map)
    build.onResolve({ filter: /^std\// }, (args) => {
      // Map std/fmt/colors to our ANSI shim (bundle inline, not external)
      if (args.path.startsWith("std/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }

      // Map to Node.js equivalents or mark as external
      const stdMappings: Record<string, string> = {
        "std/path": "path",
        "std/path/mod.ts": "path",
        "std/fs": "fs",
        "std/fs/mod.ts": "fs",
        "std/testing/bdd.ts": "@std/testing-bdd",
        "std/expect": "expect",
        "std/front_matter": "gray-matter",
        "std/assert": "assert",
        "std/flags": "minimist",
        "std/flags/mod.ts": "minimist",
        "std/yaml": "yaml",
        "std/yaml/parse.ts": "yaml",
      };
      const mapped = Object.entries(stdMappings).find(([k]) => args.path.startsWith(k));
      if (mapped) {
        return { path: mapped[1], external: true };
      }
      console.warn(`[build-npm] Unmapped std/ import: ${args.path}`);
      return { path: args.path, external: true };
    });

    // Rewrite URL imports to npm packages
    build.onResolve({ filter: /^https:\/\// }, (args) => {
      // Handle deno.land/std URLs FIRST
      if (args.path.includes("deno.land/std")) {
        if (args.path.includes("/path/") || args.path.includes("/path@")) {
          return { path: "path", external: true };
        }
        if (args.path.includes("/fmt/colors")) {
          // Use our ANSI shim instead of picocolors
          return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
        }
        if (args.path.includes("/fs/") || args.path.includes("/fs@")) {
          return { path: "fs", external: true };
        }
        if (args.path.includes("/assert/") || args.path.includes("/assert@")) {
          return { path: "assert", external: true };
        }
        if (args.path.includes("/testing/")) {
          // Testing imports are typically not needed in npm build
          return { path: "@std/testing", external: true };
        }
        if (args.path.includes("/front_matter/")) {
          return { path: "gray-matter", external: true };
        }
        if (args.path.includes("/yaml/")) {
          return { path: "yaml", external: true };
        }
        if (args.path.includes("/flags/")) {
          return { path: "minimist", external: true };
        }
        console.warn(`[build-npm] Unmapped Deno std URL: ${args.path}`);
        return { path: "path", external: true }; // Default fallback
      }

      // Check explicit mappings
      const npmPkg = importMappings[args.path];
      if (npmPkg) {
        return { path: npmPkg, external: true };
      }

      // For esm.sh URLs, try to extract package name
      const match = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
      if (match) {
        return { path: match[1], external: true };
      }

      // For other deno.land/x URLs
      const denoXMatch = args.path.match(/deno\.land\/x\/([^@/]+)/);
      if (denoXMatch) {
        console.warn(`[build-npm] Deno third-party import: ${args.path}`);
        return { path: denoXMatch[1], external: true };
      }

      console.warn(`[build-npm] Unknown URL import: ${args.path}`);
      return { path: args.path, external: true };
    });

    // Handle @veryfront/* internal imports - resolve using the import map from deno.json
    build.onResolve({ filter: /^@veryfront/ }, (args) => {
      const importPath = args.path;

      // First, try exact match in import map
      if (veryfrontImportMap[importPath]) {
        return { path: veryfrontImportMap[importPath] };
      }

      // Try prefix matches (for @veryfront/ pattern which maps to ./src/)
      // Sort by length (longest first) to match most specific pattern
      const sortedKeys = Object.keys(veryfrontImportMap)
        .filter(k => k.endsWith("/"))
        .sort((a, b) => b.length - a.length);

      for (const prefix of sortedKeys) {
        if (importPath.startsWith(prefix.slice(0, -1))) {
          const mappedPrefix = veryfrontImportMap[prefix];
          if (!mappedPrefix) continue;
          const remainder = importPath.slice(prefix.length - 1);
          const resolvedPath = resolve(mappedPrefix.replace(/\/$/, ""), remainder.replace(/^\//, ""));
          return { path: resolvedPath };
        }
      }

      // Fallback: try to resolve as src path
      const fallbackPath = resolve(PROJECT_ROOT, "src", importPath.replace("@veryfront/", "").replace("@veryfront", ""));
      return { path: fallbackPath };
    });

    // Handle @std/* imports - map to external packages
    build.onResolve({ filter: /^@std\// }, (args) => {
      const stdMappings: Record<string, string> = {
        "@std/path": "path",
        "@std/fs": "fs",
        "@std/testing/bdd.ts": "@std/testing-bdd",
        "@std/expect": "expect",
      };
      const mapped = Object.entries(stdMappings).find(([k]) => args.path.startsWith(k));
      if (mapped) {
        return { path: mapped[1], external: true };
      }
      return { path: "path", external: true }; // Default to path for unknown @std
    });

    // Keep ai, react, etc. as external
    build.onResolve({ filter: /^(react|react-dom|ai|@ai-sdk|zod)/ }, (args) => {
      return { path: args.path, external: true };
    });

    // Handle Deno namespace
    build.onResolve({ filter: /^deno:/ }, () => {
      return { path: "@aspect/deno-shims", external: true };
    });
  },
};

// Pre-bundle client runtime scripts FIRST (before CLI build)
// These need to be in templates.ts before the CLI bundle is created
console.log("📝 Pre-bundling client runtime scripts...\n");

// Create a minimal plugin for pre-bundling client scripts
const clientBundlePlugin: esbuild.Plugin = {
  name: "client-bundle",
  setup(build) {
    // Handle std/ imports
    build.onResolve({ filter: /^std\// }, (args) => {
      if (args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      return { path: "node:path", external: true };
    });

    // Handle @std/* imports
    build.onResolve({ filter: /^@std\// }, (args) => {
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      return { path: "node:path", external: true };
    });

    // Handle @veryfront/* imports - resolve to actual source files
    build.onResolve({ filter: /^@veryfront/ }, (args) => {
      const importPath = args.path;
      if (veryfrontImportMap[importPath]) {
        return { path: veryfrontImportMap[importPath] };
      }

      const sortedKeys = Object.keys(veryfrontImportMap)
        .filter(k => k.endsWith("/"))
        .sort((a, b) => b.length - a.length);

      for (const prefix of sortedKeys) {
        if (importPath.startsWith(prefix.slice(0, -1))) {
          const mappedPrefix = veryfrontImportMap[prefix];
          if (!mappedPrefix) continue;
          const remainder = importPath.slice(prefix.length - 1);
          const resolvedPath = resolve(mappedPrefix.replace(/\/$/, ""), remainder.replace(/^\//, ""));
          return { path: resolvedPath };
        }
      }

      const fallbackPath = resolve(PROJECT_ROOT, "src", importPath.replace("@veryfront/", "").replace("@veryfront", ""));
      return { path: fallbackPath };
    });

    // Handle URL imports
    build.onResolve({ filter: /^https:\/\// }, (args) => {
      if (args.path.includes("deno.land/std") && args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      const esmMatch = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
      if (esmMatch) return { path: esmMatch[1], external: true };
      return { path: args.path, external: true };
    });

    // External npm packages
    build.onResolve({ filter: /^(react|react-dom)/ }, (args) => {
      return { path: args.path, external: true };
    });

    // Node built-ins
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
  },
};

async function prebundleClientScript(entryPath: string, name: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false,
    sourcemap: false,
    packages: "external",
    mainFields: ["module", "browser", "main"],
    plugins: [clientBundlePlugin],
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error(`Failed to pre-bundle ${name}`);
  }
  return output;
}

let CLIENT_ROUTER_BUNDLE = "";
let CLIENT_PREFETCH_BUNDLE = "";

try {
  CLIENT_ROUTER_BUNDLE = await prebundleClientScript(
    "./src/rendering/client/router.ts",
    "client router"
  );
  console.log(`  ✓ Pre-bundled client router: ${(CLIENT_ROUTER_BUNDLE.length / 1024).toFixed(1)} KB`);

  CLIENT_PREFETCH_BUNDLE = await prebundleClientScript(
    "./src/rendering/client/prefetch.ts",
    "client prefetch"
  );
  console.log(`  ✓ Pre-bundled client prefetch: ${(CLIENT_PREFETCH_BUNDLE.length / 1024).toFixed(1)} KB`);

  // Write pre-bundled client scripts to templates.ts BEFORE CLI build
  const templatesPath = "./src/build/production-build/templates.ts";
  const existingTemplates = await Deno.readTextFile(templatesPath);

  // Escape backticks and dollar signs for template literal
  const escapeForTemplate = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

  // Replace the placeholder variables with actual values
  let updatedTemplates = existingTemplates
    .replace(
      /export let CLIENT_ROUTER_BUNDLE: string \| undefined;/,
      `export const CLIENT_ROUTER_BUNDLE: string = \`${escapeForTemplate(CLIENT_ROUTER_BUNDLE)}\`;`
    )
    .replace(
      /export let CLIENT_PREFETCH_BUNDLE: string \| undefined;/,
      `export const CLIENT_PREFETCH_BUNDLE: string = \`${escapeForTemplate(CLIENT_PREFETCH_BUNDLE)}\`;`
    );

  await Deno.writeTextFile(templatesPath, updatedTemplates);
  console.log("  ✓ Updated templates.ts with pre-bundled client scripts\n");
} catch (error) {
  console.error("  ⚠ Failed to pre-bundle client scripts:", error);
  console.log("  Using empty fallback - client scripts may not work in npm build\n");
}

console.log("📝 Building ESM modules...\n");

// Build each entry point
for (const [name, entryPath] of Object.entries(entryPoints)) {
  const outfile = join(OUT_DIR, "dist", `${name}.js`);
  await ensureDir(dirname(outfile));

  console.log(`  Building ${name}...`);

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "esnext",
      sourcemap: true,
      splitting: false,
      treeShaking: true,
      minify: false, // Keep readable for debugging
      plugins: [denoResolvePlugin],
      supported: {
        "top-level-await": true,
      },
      external: [
        // React ecosystem
        "react",
        "react-dom",
        "react/*",
        "react-dom/*",
        // AI SDK
        "ai",
        "ai/*",
        "@ai-sdk/*",
        // Validation
        "zod",
        // MDX ecosystem
        "@mdx-js/*",
        "unified",
        "remark-*",
        "rehype-*",
        "unist-*",
        "mdast-*",
        "hast-*",
        // Build tools
        "esbuild",
        // Utilities
        "mime-types",
        "github-slugger",
        "picocolors",
        // CSS
        "unocss",
        "@unocss/*",
        // Observability
        "@opentelemetry/*",
        // Redis
        "redis",
        "@redis/*",
        // Node.js built-ins
        "node:*",
        "fs",
        "fs/*",
        "path",
        "crypto",
        "http",
        "https",
        "stream",
        "stream/*",
        "util",
        "util/*",
        "events",
        "buffer",
        "url",
        "os",
        "child_process",
        "net",
        "tls",
        "zlib",
        "dns",
        "assert",
        "querystring",
        "string_decoder",
        "timers",
        "timers/*",
        "worker_threads",
        "perf_hooks",
        "async_hooks",
        "vm",
        "module",
        "process",
      ],
      define: {
        "Deno.env.get": "process.env",
        "Deno.cwd": "process.cwd",
      },
      jsx: "automatic",
      jsxImportSource: "react",
    });
  } catch (error) {
    console.error(`  ❌ Failed to build ${name}:`, error);
  }
}

// Build CLI as a single bundled file (circular dependency fix enabled bundling)
console.log("\n📝 Building CLI (bundled)...\n");

// Create the CLI bundle plugin - reuses denoResolvePlugin with CLI-specific mappings
const cliBundlePlugin: esbuild.Plugin = {
  name: "cli-bundle",
  setup(build) {
    // Handle npm: prefixed imports
    build.onResolve({ filter: /^npm:/ }, (args) => {
      const npmPkg = args.path.replace(/^npm:/, "").replace(/@[\d.]+$/, "");
      return { path: npmPkg, external: true };
    });

    // Handle std/ imports - resolve to TypeScript shims that get bundled
    build.onResolve({ filter: /^std\// }, (args) => {
      // front_matter shim - has extract() function compatible with Deno
      if (args.path.includes("front_matter")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts") };
      }
      // fs shim - has exists(), ensureDir(), walk() functions
      if (args.path.includes("/fs")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
      }
      // path shim - has SEPARATOR and other Deno-specific exports
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      // colors - use our ANSI shim (picocolors is CJS and doesn't work with named imports)
      if (args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      if (args.path.includes("/flags")) return { path: "mri", external: true };
      if (args.path.includes("/yaml")) return { path: "yaml", external: true };
      if (args.path.includes("/assert")) return { path: "node:assert", external: true };
      console.warn(`[cli-bundle] Unmapped std/ import: ${args.path}`);
      return { path: "node:path", external: true };
    });

    // Handle @std/* imports (JSR format) - resolve to TypeScript shims
    build.onResolve({ filter: /^@std\// }, (args) => {
      // path shim - has fromFileUrl() and toFileUrl() + all node:path functions
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      // fs shim
      if (args.path.includes("/fs")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
      }
      if (args.path.includes("/assert")) return { path: "node:assert", external: true };
      console.warn(`[cli-bundle] Unmapped @std/ import: ${args.path}`);
      return { path: "node:path", external: true };
    });

    // Handle @veryfront/* imports - resolve to actual source files for bundling
    build.onResolve({ filter: /^@veryfront/ }, (args) => {
      const importPath = args.path;
      if (veryfrontImportMap[importPath]) {
        return { path: veryfrontImportMap[importPath] };
      }

      const sortedKeys = Object.keys(veryfrontImportMap)
        .filter(k => k.endsWith("/"))
        .sort((a, b) => b.length - a.length);

      for (const prefix of sortedKeys) {
        if (importPath.startsWith(prefix.slice(0, -1))) {
          const mappedPrefix = veryfrontImportMap[prefix];
          if (!mappedPrefix) continue;
          const remainder = importPath.slice(prefix.length - 1);
          const resolvedPath = resolve(mappedPrefix.replace(/\/$/, ""), remainder.replace(/^\//, ""));
          return { path: resolvedPath };
        }
      }

      const fallbackPath = resolve(PROJECT_ROOT, "src", importPath.replace("@veryfront/", "").replace("@veryfront", ""));
      return { path: fallbackPath };
    });

    // Handle URL imports
    build.onResolve({ filter: /^https:\/\// }, (args) => {
      if (args.path.includes("deno.land/x/esbuild")) return { path: "esbuild", external: true };
      if (args.path.includes("deno.land/std")) {
        if (args.path.includes("/path")) {
          return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
        }
        if (args.path.includes("/fs")) {
          return { path: resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
        }
        if (args.path.includes("/fmt/colors")) {
          return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
        }
        if (args.path.includes("/front_matter")) {
          return { path: resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts") };
        }
        if (args.path.includes("/assert")) return { path: "node:assert", external: true };
        return { path: "node:path", external: true };
      }
      const esmMatch = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
      if (esmMatch) return { path: esmMatch[1], external: true };
      return { path: args.path, external: true };
    });

    // Keep node: imports as-is
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));

    // Handle esbuild - Deno uses esbuild/mod.js, npm uses esbuild
    build.onResolve({ filter: /^esbuild/ }, () => ({ path: "esbuild", external: true }));

    // External npm packages
    build.onResolve({ filter: /^(react|react-dom|zod|ai|@ai-sdk|picocolors|mri|yaml|gray-matter|ws)/ }, (args) => {
      return { path: args.path, external: true };
    });
  },
};

// Build the CLI as a single bundle
try {
  await esbuild.build({
    entryPoints: ["./src/cli/index/cli-main.ts"],
    outfile: join(OUT_DIR, "dist", "cli.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "esnext",
    sourcemap: false, // No source maps for smaller package
    plugins: [cliBundlePlugin],
    supported: { "top-level-await": true },
    external: [
      // React ecosystem
      "react", "react-dom", "react/*", "react-dom/*",
      // AI SDK
      "ai", "ai/*", "@ai-sdk/*",
      // Validation
      "zod",
      // MDX ecosystem
      "@mdx-js/*", "unified", "remark-*", "rehype-*",
      "unist-*", "mdast-*", "hast-*",
      // Build tools
      "esbuild",
      // Utilities
      "mime-types", "github-slugger", "picocolors",
      "mri", "yaml", "gray-matter",
      // CSS
      "unocss", "@unocss/*", "lightningcss",
      // Observability
      "@opentelemetry/*",
      // Node.js built-ins
      "node:*",
    ],
    jsx: "automatic",
    jsxImportSource: "react",
  });
  const stat = await Deno.stat(join(OUT_DIR, "dist", "cli.js"));
  console.log(`  ✓ Built CLI bundle: ${(stat.size / 1024).toFixed(1)} KB (single file)`);
} catch (error) {
  console.error("  ❌ Failed to build CLI bundle:", error);
}

// Note: Shims are now bundled from src/_shims/*.ts into cli.js
// No separate shim files needed in the output

// Generate package.json
console.log("\n📄 Generating package.json...");

const packageJson = {
  name: "veryfront",
  version,
  description: "Zero-config React meta-framework for building agentic AI applications",
  type: "module",
  main: "./dist/index.js",
  module: "./dist/index.js",
  bin: {
    veryfront: "./bin/veryfront.js",
  },
  exports: {
    ".": {
      import: "./dist/index.js",
    },
    "./components": {
      import: "./dist/components.js",
    },
    "./data": {
      import: "./dist/data.js",
    },
    "./config": {
      import: "./dist/config.js",
    },
    "./ai": {
      import: "./dist/ai/index.js",
    },
    "./ai/client": {
      import: "./dist/ai/client.js",
    },
    "./ai/react": {
      import: "./dist/ai/react.js",
    },
    "./ai/primitives": {
      import: "./dist/ai/primitives.js",
    },
    "./ai/components": {
      import: "./dist/ai/components.js",
    },
    "./ai/production": {
      import: "./dist/ai/production.js",
    },
    "./ai/dev": {
      import: "./dist/ai/dev.js",
    },
  },
  files: [
    "bin",
    "dist",
    "README.md",
    "LICENSE",
  ],
  keywords: [
    "react",
    "framework",
    "ai",
    "agents",
    "mcp",
    "llm",
    "anthropic",
    "openai",
    "ssr",
    "rsc",
    "server-components",
    "typescript",
  ],
  license: "MIT",
  author: "Veryfront",
  repository: {
    type: "git",
    url: "git+https://github.com/veryfront/veryfront.git",
  },
  bugs: {
    url: "https://github.com/veryfront/veryfront/issues",
  },
  homepage: "https://github.com/veryfront/veryfront#readme",
  engines: {
    node: ">=18.0.0",
  },
  peerDependencies: {
    react: "^17.0.0 || ^18.0.0 || ^19.0.0",
    "react-dom": "^17.0.0 || ^18.0.0 || ^19.0.0",
    zod: "^3.22.0 || ^4.0.0",
  },
  peerDependenciesMeta: {
    zod: {
      optional: false,
    },
  },
  dependencies: {
    ai: "^5.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/react": "^2.0.0",
    esbuild: "^0.20.0",
    "@mdx-js/mdx": "^3.0.0",
    "@mdx-js/react": "^3.0.0",
    "mime-types": "^2.1.35",
    "unified": "^11.0.0",
    "remark-gfm": "^4.0.0",
    "remark-frontmatter": "^5.0.0",
    "rehype-highlight": "^7.0.0",
    "rehype-slug": "^6.0.0",
    "github-slugger": "^2.0.0",
    "picocolors": "^1.1.0",
    // CLI dependencies
    "mri": "^1.2.0", // ESM-compatible CLI arg parser (replaces minimist)
    "yaml": "^2.3.0",
    "gray-matter": "^4.0.3",
    // Dev server WebSocket support (HMR on Node.js)
    "ws": "^8.18.0",
    // Build/optimization tools (optional)
    "lightningcss": "^1.22.0",
    // CSS
    "@unocss/core": "^0.59.0",
    "@unocss/preset-wind": "^0.59.0",
  },
  devDependencies: {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^20.0.0",
    typescript: "^5.0.0",
  },
};

await Deno.writeTextFile(
  join(OUT_DIR, "package.json"),
  JSON.stringify(packageJson, null, 2)
);

// Create CLI bin wrapper with Node.js shebang
console.log("📄 Creating CLI bin wrapper...");
await ensureDir(join(OUT_DIR, "bin"));
const cliBinContent = `#!/usr/bin/env node
// CLI entry point - calls main() from the bundled CLI
import { main } from '../dist/cli.js';
main().catch(err => {
  console.error(err);
  process.exit(1);
});
`;
const binPath = join(OUT_DIR, "bin", "veryfront.js");
await Deno.writeTextFile(binPath, cliBinContent);
// Make the bin file executable
await Deno.chmod(binPath, 0o755);

// Copy README and LICENSE
console.log("📄 Copying additional files...");
try {
  await Deno.copyFile("README.md", join(OUT_DIR, "README.md"));
} catch {
  console.log("  No README.md found");
}
try {
  await Deno.copyFile("LICENSE", join(OUT_DIR, "LICENSE"));
} catch {
  console.log("  No LICENSE found, creating MIT license...");
  await Deno.writeTextFile(join(OUT_DIR, "LICENSE"), `MIT License

Copyright (c) ${new Date().getFullYear()} Veryfront

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
}

// Clean up esbuild
esbuild.stop();

console.log(`
✅ Build complete!

📦 Output: ${OUT_DIR}/

📋 Test locally:
   cd npm && npm link

   # In a test project:
   npm link veryfront

   # Test CLI:
   npx veryfront --help

📋 Publish:
   cd npm && npm publish
`);
