/**
 * Simplified Bun preload script for import aliasing.
 *
 * This plugin handles:
 * 1. #veryfront/* aliases → ./src/* paths
 * 2. #std/* and @std/* aliases → compat shims
 * 3. npm: protocol stripping (for Deno compat)
 * 4. file:// URLs with query params (cache busting)
 */

import { plugin } from "bun";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";

const projectRoot = resolve(dirname(import.meta.dir), "../..");

const stdImportMap: Record<string, string> = {
  "#std/assert": "./src/testing/assert.ts",
  "#std/assert.ts": "./src/testing/assert.ts",
  "#std/testing": "./src/testing/index.ts",
  "#std/testing.ts": "./src/testing/index.ts",
  "#std/testing/bdd": "./src/testing/bdd.ts",
  "#std/testing/bdd.ts": "./src/testing/bdd.ts",
  "#std/expect": "./src/platform/compat/std/expect.ts",
  "#std/expect.ts": "./src/platform/compat/std/expect.ts",
  "#std/async": "./src/platform/compat/std/async.ts",
  "#std/async.ts": "./src/platform/compat/std/async.ts",
  "#std/dotenv": "./src/platform/compat/std/dotenv.ts",
  "#std/dotenv.ts": "./src/platform/compat/std/dotenv.ts",
  "#std/flags": "./src/platform/compat/std/flags.ts",
  "#std/flags.ts": "./src/platform/compat/std/flags.ts",
  "#std/fmt/colors": "./src/platform/compat/std/fmt-colors.ts",
  "#std/fmt/colors.ts": "./src/platform/compat/std/fmt-colors.ts",
  "#std/front-matter/yaml": "./src/platform/compat/std/front-matter-yaml.ts",
  "#std/front-matter/yaml.ts": "./src/platform/compat/std/front-matter-yaml.ts",
  "#std/fs": "./src/platform/compat/std/fs.ts",
  "#std/fs.ts": "./src/platform/compat/std/fs.ts",
  "#std/path": "./src/platform/compat/std/path.ts",
  "#std/path.ts": "./src/platform/compat/std/path.ts",
  "#std/path/posix": "./src/platform/compat/std/path.ts",
  "#std/path/posix.ts": "./src/platform/compat/std/path.ts",
};

const reactImportMap: Record<string, string> = {
  react: "./npm/node_modules/react/index.js",
  "react/jsx-runtime": "./npm/node_modules/react/jsx-runtime.js",
  "react/jsx-dev-runtime": "./npm/node_modules/react/jsx-dev-runtime.js",
  "react-dom": "./npm/node_modules/react-dom/index.js",
  "react-dom/client": "./npm/node_modules/react-dom/client.js",
  "react-dom/server": "./npm/node_modules/react-dom/server.node.js",
  "react-dom/static": "./npm/node_modules/react-dom/static.node.js",
};

const importMap: Record<string, string> = {
  "#deno-config": "./deno.json",
  ...stdImportMap,
  ...reactImportMap,
};

function findProjectModule(candidate: string): string | null {
  const fullPath = resolve(projectRoot, candidate.replace(/^\.\//, ""));
  const tryPaths = [
    fullPath,
    `${fullPath}.ts`,
    `${fullPath}.tsx`,
    `${fullPath}.js`,
    `${fullPath}.mjs`,
    `${fullPath}.json`,
    resolve(fullPath, "index.ts"),
    resolve(fullPath, "index.tsx"),
    resolve(fullPath, "index.js"),
    resolve(fullPath, "index.mjs"),
  ];

  for (const path of tryPaths) {
    if (existsSync(path) && statSync(path).isFile()) {
      return path;
    }
  }

  return null;
}

function resolveImport(specifier: string): string | null {
  const stdNormalized = specifier.startsWith("@std/")
    ? `#std/${specifier.slice("@std/".length)}`
    : specifier.startsWith("std/")
      ? `#std/${specifier.slice("std/".length)}`
      : specifier;

  const mapped = importMap[specifier] ?? importMap[stdNormalized];
  if (mapped) {
    return findProjectModule(mapped);
  }

  if (specifier === "#veryfront" || specifier === "veryfront") {
    return findProjectModule("./src/index.ts");
  }

  if (specifier.startsWith("#veryfront/")) {
    return findProjectModule(`./src/${specifier.slice("#veryfront/".length)}`);
  }

  if (specifier.startsWith("veryfront/")) {
    return findProjectModule(`./src/${specifier.slice("veryfront/".length)}`);
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

    build.onResolve({ filter: /^(#deno-config|@std\/|#std\/|std\/|#veryfront(?:\/|$)|veryfront(?:\/|$)|react(?:$|\/jsx-runtime$|\/jsx-dev-runtime$)|react-dom(?:$|\/client$|\/server$|\/static$))/ }, (args) => {
      const resolved = resolveImport(args.path);
      if (resolved) {
        return { path: resolved };
      }
      return undefined;
    });

    // Let Bun handle everything else natively:
    // - all other bare imports
  },
});
