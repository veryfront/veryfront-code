/**
 * Simplified Bun preload script for import aliasing.
 *
 * This plugin now ONLY handles:
 * 1. @veryfront/* aliases → ./src/* paths
 * 2. @std/* aliases → ./src/platform/compat/std/* shims
 * 3. npm: protocol stripping (for Deno compat)
 * 4. file:// URLs with query params (cache busting)
 *
 * React and HTTP modules are now handled by shared facades (src/react/shared-*.ts)
 * which use node_modules in Bun (no esm.sh fetching needed).
 *
 * Note: To fully eliminate this plugin, migrate imports to use # prefix:
 * - @veryfront/* → #veryfront/*
 * - @std/* → #std/*
 * Then package.json imports field will work natively.
 */

import { plugin } from "bun";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";

const projectRoot = resolve(dirname(import.meta.dir), "..");

// Import map for local file resolution
const importMap: Record<string, string> = {
  // Testing
  "@veryfront/testing": "./src/testing/index.ts",
  "@veryfront/testing/assert": "./src/testing/assert.ts",
  "@veryfront/testing/bdd": "./src/testing/bdd.ts",
  "@veryfront/testing/deno-compat": "./src/testing/deno-compat.ts",

  // Platform compat
  "@veryfront/compat/fs": "./src/platform/compat/fs.ts",
  "@veryfront/compat/path": "./src/platform/compat/path/index.ts",
  "@veryfront/compat/process": "./src/platform/compat/process.ts",
  "@veryfront/platform/compat/runtime": "./src/platform/compat/runtime.ts",
  "@veryfront/platform/compat/fs": "./src/platform/compat/fs.ts",
  "@veryfront/platform/compat/path/index": "./src/platform/compat/path/index.ts",

  // Std compat
  "@std/assert": "./src/testing/assert.ts",
  "@std/testing/bdd": "./src/testing/bdd.ts",
  "@std/expect": "./src/platform/compat/std/expect.ts",
  "@std/async": "./src/platform/compat/std/async.ts",
  "@std/dotenv": "./src/platform/compat/std/dotenv.ts",
  "@std/flags": "./src/platform/compat/std/flags.ts",
  "@std/fmt/colors": "./src/platform/compat/std/fmt-colors.ts",
  "@std/front-matter/yaml": "./src/platform/compat/std/front-matter-yaml.ts",
  "@std/fs": "./src/platform/compat/std/fs.ts",
  "@std/path": "./src/platform/compat/std/path.ts",
};

function resolveImport(specifier: string): string | null {
  // Direct match
  if (importMap[specifier]) {
    return resolve(projectRoot, importMap[specifier]);
  }

  // Prefix match for @veryfront/*
  if (specifier.startsWith("@veryfront/")) {
    const subpath = specifier.replace("@veryfront/", "");
    const candidates = [
      `./src/${subpath}.ts`,
      `./src/${subpath}/index.ts`,
      `./src/${subpath.replace(/\//g, "/")}.ts`,
    ];

    for (const candidate of candidates) {
      const fullPath = resolve(projectRoot, candidate);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return fullPath;
      }
    }
  }

  return null;
}

plugin({
  name: "veryfront-resolver",
  setup(build) {
    // Handle file:// URLs with query params (cache busting)
    build.onResolve({ filter: /^file:.*\?.+/ }, (args) => ({
      path: args.path,
      namespace: "vf-file-cache",
    }));

    build.onLoad({ filter: /.*/, namespace: "vf-file-cache" }, (args) => {
      const url = new URL(args.path);
      url.search = "";
      url.hash = "";
      const filePath = fileURLToPath(url);
      const extension = extname(filePath).toLowerCase();
      const loader =
        extension === ".ts"
          ? "ts"
          : extension === ".tsx"
            ? "tsx"
            : extension === ".jsx"
              ? "jsx"
              : extension === ".json"
                ? "json"
                : "js";

      return {
        contents: readFileSync(filePath, "utf-8"),
        loader,
        resolveDir: dirname(filePath),
      };
    });

    // Handle npm: protocol (Deno-style) by stripping to local package name
    build.onResolve({ filter: /^npm:/ }, (args) => {
      const packageSpec = args.path.slice(4);
      const atIndex = packageSpec.indexOf("@", 1);
      const packageName = atIndex > 0 ? packageSpec.slice(0, atIndex) : packageSpec;
      return { path: packageName };
    });

    // Handle @veryfront/* imports
    build.onResolve({ filter: /^@veryfront\// }, (args) => {
      const resolved = resolveImport(args.path);
      if (resolved) {
        return { path: resolved };
      }
      return undefined;
    });

    // Handle @std/* imports
    build.onResolve({ filter: /^@std\// }, (args) => {
      const resolved = resolveImport(args.path);
      if (resolved) {
        return { path: resolved };
      }
      return undefined;
    });

    // Let Bun handle everything else natively:
    // - react, react-dom → node_modules (package.json dependencies)
    // - HTTP modules → not used in Bun (shared facades use node_modules)
  },
});
