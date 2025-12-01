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

const __dirname = dirname(fromFileUrl(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = denoJson.version || "0.0.6";
const denoImports: Record<string, string> = denoJson.imports || {};

const veryfrontImportMap: Record<string, string> = {};
for (const [key, value] of Object.entries(denoImports)) {
  if (key.startsWith("@veryfront") && typeof value === "string" && value.startsWith("./")) {
    veryfrontImportMap[key] = resolve(PROJECT_ROOT, value);
  }
}

/**
 * Resolve @veryfront/* imports to actual file paths
 */
function resolveVeryfrontImport(importPath: string): string {
  // Direct match
  if (veryfrontImportMap[importPath]) {
    return veryfrontImportMap[importPath];
  }

  // Check prefix matches (e.g., @veryfront/utils/ -> ./src/core/utils/)
  const sortedKeys = Object.keys(veryfrontImportMap)
    .filter(k => k.endsWith("/"))
    .sort((a, b) => b.length - a.length);

  for (const prefix of sortedKeys) {
    if (importPath.startsWith(prefix.slice(0, -1))) {
      const mappedPrefix = veryfrontImportMap[prefix];
      if (!mappedPrefix) continue;
      const remainder = importPath.slice(prefix.length - 1);
      const resolvedPath = resolve(mappedPrefix.replace(/\/$/, ""), remainder.replace(/^\//, ""));
      return resolvedPath;
    }
  }

  // Fallback: assume src/<path> structure
  const fallbackPath = resolve(PROJECT_ROOT, "src", importPath.replace("@veryfront/", "").replace("@veryfront", ""));
  return fallbackPath;
}

const OUT_DIR = "./npm";

console.log(`\n📦 Building Veryfront v${version} for npm...\n`);

try {
  await Deno.remove(OUT_DIR, { recursive: true });
} catch {
}
await ensureDir(OUT_DIR);
await ensureDir(join(OUT_DIR, "dist"));

const entryPoints: Record<string, string> = {
  "ai/index": "./src/ai/index.ts",
  "ai/client": "./src/ai/client.ts",
  "ai/react": "./src/ai/react/index.ts",
  "ai/primitives": "./src/ai/react/primitives/index.ts",
  "ai/components": "./src/ai/react/components/index.ts",
  "ai/production": "./src/ai/production/index.ts",
  "ai/dev": "./src/ai/dev/index.ts",
  "config": "./src/core/config/index.ts",
  "data": "./src/data/index.ts",
  "components": "./src/react/components/index.ts",
  "index": "./src/index.ts",
};

// Import mappings: Deno URLs -> npm packages
// Generated dynamically from deno.json to avoid duplication
const importMappings: Record<string, string> = {};

for (const [key, value] of Object.entries(denoImports)) {
  // Skip local imports (starting with ./ or /)
  if (value.startsWith("./") || value.startsWith("/")) continue;
  
  // Skip internal @veryfront imports if they point to URLs (unlikely but good safety)
  if (key.startsWith("@veryfront/")) continue;

  // Map the URL (value) to the package name (key)
  importMappings[value] = key;
}

const denoResolvePlugin: esbuild.Plugin = {
  name: "deno-resolve",
  setup(build) {
    build.onResolve({ filter: /^npm:/ }, (args) => {
      const npmPkg = args.path.replace(/^npm:/, "").replace(new RegExp("@[\\d.]+$"), "");
      return { path: npmPkg, external: true };
    });

    build.onResolve({ filter: /^std\// }, (args) => {
      if (args.path.startsWith("std/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }

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

    build.onResolve({ filter: /^https:\/\// }, (args) => {
      if (args.path.includes("deno.land/std")) {
        if (args.path.includes("/path/") || args.path.includes("/path@")) {
          return { path: "path", external: true };
        }
        if (args.path.includes("/fmt/colors")) {
          return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
        }
        if (args.path.includes("/fs/") || args.path.includes("/fs@")) {
          return { path: "fs", external: true };
        }
        if (args.path.includes("/assert/") || args.path.includes("/assert@")) {
          return { path: "assert", external: true };
        }
        if (args.path.includes("/testing/")) {
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
        return { path: "path", external: true };
      }

      const npmPkg = importMappings[args.path];
      if (npmPkg) {
        return { path: npmPkg, external: true };
      }

      const match = args.path.match(new RegExp("esm\\.sh/(@?[^@/]+(?:/[^@/]+)?)"));
      if (match) {
        return { path: match[1], external: true };
      }

      const denoXMatch = args.path.match(new RegExp("deno\\.land/x/([^@/]+)"));
      if (denoXMatch) {
        console.warn(`[build-npm] Deno third-party import: ${args.path}`);
        return { path: denoXMatch[1], external: true };
      }

      console.warn(`[build-npm] Unknown URL import: ${args.path}`);
      return { path: args.path, external: true };
    });

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
      return { path: "path", external: true };
    });

    build.onResolve({ filter: /^(react|react-dom|ai|@ai-sdk|zod)/ }, (args) => {
      return { path: args.path, external: true };
    });

    build.onResolve({ filter: /^deno:/ }, () => {
      return { path: "@aspect/deno-shims", external: true };
    });
  },
};

console.log("📝 Pre-bundling client runtime scripts...\n");
const clientBundlePlugin: esbuild.Plugin = {
  name: "client-bundle",
  setup(build) {
    build.onResolve({ filter: /^std\// }, (args) => {
      if (args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      return { path: "node:path", external: true };
    });

    build.onResolve({ filter: /^@std\// }, (args) => {
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      return { path: "node:path", external: true };
    });

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

    build.onResolve({ filter: /^https:\/\// }, (args) => {
      if (args.path.includes("deno.land/std") && args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      const esmMatch = args.path.match(new RegExp("esm\\.sh/(@?[^@/]+(?:/[^@/]+)?)"));
      if (esmMatch) return { path: esmMatch[1], external: true };
      return { path: args.path, external: true };
    });

    build.onResolve({ filter: /^(react|react-dom)/ }, (args) => {
      return { path: args.path, external: true };
    });

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

  console.log("  ✓ Generated client bundles (will be injected via plugin)\n");
} catch (error) {
  console.error("  ⚠ Failed to pre-bundle client scripts:", error);
  console.log("  Using empty fallback - client scripts may not work in npm build\n");
}

const templateInjectionPlugin: esbuild.Plugin = {
  name: "template-injection",
  setup(build) {
    build.onLoad({ filter: /templates\.ts$/ }, async (args) => {
      let content = await Deno.readTextFile(args.path);

      const routerDecl = `export const CLIENT_ROUTER_BUNDLE: string = ${JSON.stringify(CLIENT_ROUTER_BUNDLE)};`;
      const prefetchDecl = `export const CLIENT_PREFETCH_BUNDLE: string = ${JSON.stringify(CLIENT_PREFETCH_BUNDLE)};`;

      if (content.includes('export let CLIENT_ROUTER_BUNDLE')) {
        content = content.replace(/export let CLIENT_ROUTER_BUNDLE[^;]*;/, routerDecl);
      } else {
        content = content.replace(/export const CLIENT_ROUTER_BUNDLE[\s\S]*?;/, routerDecl);
      }

      if (content.includes('export let CLIENT_PREFETCH_BUNDLE')) {
        content = content.replace(/export let CLIENT_PREFETCH_BUNDLE[^;]*;/, prefetchDecl);
      } else {
        content = content.replace(/export const CLIENT_PREFETCH_BUNDLE[\s\S]*?;/, prefetchDecl);
      }

      return { contents: content, loader: 'ts' };
    });
  }
};

console.log("📝 Building ESM modules...\n");

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
      minify: false, 
      plugins: [denoResolvePlugin, templateInjectionPlugin],
      supported: {
        "top-level-await": true,
      },
      external: [
        "react",
        "react-dom",
        "react/*",
        "react-dom/*",
        "ai",
        "ai/*",
        "@ai-sdk/*",
        "zod",
        "@mdx-js/*",
        "unified",
        "remark-*",
        "rehype-*",
        "unist-*",
        "mdast-*",
        "hast-*",
        "esbuild",
        "mime-types",
        "github-slugger",
        "picocolors",
        "unocss",
        "@unocss/*",
        "@opentelemetry/*",
        "redis",
        "@redis/*",
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

console.log("\n📝 Building CLI (bundled)...\n");

const cliBundlePlugin: esbuild.Plugin = {
  name: "cli-bundle",
  setup(build) {
    build.onResolve({ filter: /^npm:/ }, (args) => {
      const npmPkg = args.path.replace(/^npm:/, "").replace(new RegExp("@[\\d.]+$", ""), "");
      return { path: npmPkg, external: true };
    });

    build.onResolve({ filter: /^std\// }, (args) => {
      if (args.path.includes("front_matter")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts") };
      }
      if (args.path.includes("/fs")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
      }
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      if (args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      if (args.path.includes("/flags")) return { path: "mri", external: true };
      if (args.path.includes("/yaml")) return { path: "yaml", external: true };
      if (args.path.includes("/assert")) return { path: "node:assert", external: true };
      console.warn(`[cli-bundle] Unmapped std/ import: ${args.path}`);
      return { path: "node:path", external: true };
    });

    build.onResolve({ filter: /^@veryfront/ }, (args) => {
      return { path: resolveVeryfrontImport(args.path) };
    });

    // Handle @std/* imports (Deno standard library with @ prefix)
    build.onResolve({ filter: /^@std\// }, (args) => {
      if (args.path.includes("/path")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
      }
      if (args.path.includes("/fs")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
      }
      if (args.path.includes("/front_matter")) {
        return { path: resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts") };
      }
      if (args.path.includes("/fmt/colors")) {
        return { path: resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts") };
      }
      if (args.path.includes("/yaml")) return { path: "yaml", external: true };
      if (args.path.includes("/assert")) return { path: "node:assert", external: true };
      if (args.path.includes("/testing")) return { path: "@std/testing", external: true };
      console.warn(`[cli-bundle] Unmapped @std/ import: ${args.path}`);
      return { path: "node:path", external: true };
    });

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
      const esmMatch = args.path.match(new RegExp("esm\\.sh/(@?[^@/]+(?:/[^@/]+)?)"));
      if (esmMatch) return { path: esmMatch[1], external: true };
      return { path: args.path, external: true };
    });

    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));

    build.onResolve({ filter: /^esbuild/ }, () => ({ path: "esbuild", external: true }));

    build.onResolve({ filter: /^(react|react-dom|zod|ai|@ai-sdk|picocolors|mri|yaml|gray-matter|ws)/ }, (args) => {
      return { path: args.path, external: true };
    });
  },
};

try {
  await esbuild.build({
    entryPoints: ["./src/cli/index/cli-main.ts"],
    outfile: join(OUT_DIR, "dist", "cli.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "esnext",
    sourcemap: false, 
    plugins: [cliBundlePlugin, templateInjectionPlugin],
    supported: { "top-level-await": true },
    external: [
      "react", "react-dom", "react/*", "react-dom/*",
      "ai", "ai/*", "@ai-sdk/*",
      "@mdx-js/*",
      "esbuild",
      "mime-types", "github-slugger", "picocolors",
      "mri", "yaml", "gray-matter",
      "unocss", "@unocss/*", "lightningcss",
      "@opentelemetry/*",
      "node:*",
      "glob",
    ],
    jsx: "automatic",
    jsxImportSource: "react",
  });
  const stat = await Deno.stat(join(OUT_DIR, "dist", "cli.js"));
  console.log(`  ✓ Built CLI bundle: ${(stat.size / 1024).toFixed(1)} KB (single file)`);
} catch (error) {
  console.error("  ❌ Failed to build CLI bundle:", error);
}

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
  },
  dependencies: {
    zod: "^3.22.0",
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
    "mri": "^1.2.0", 
    "yaml": "^2.3.0",
    "gray-matter": "^4.0.3",
    "ws": "^8.18.0",
    "lightningcss": "^1.22.0",
    "@unocss/core": "^0.59.0",
    "@unocss/preset-wind": "^0.59.0",
    "glob": "^11.0.0",
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
await Deno.chmod(binPath, 0o755);

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
