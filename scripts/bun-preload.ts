/**
 * Bun preload script for module resolution.
 *
 * Bun uses a plugin system for custom module resolution.
 * This sets up the @veryfront/* and @std/* import aliases.
 */

import { plugin } from "bun";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, extname, resolve, join } from "path";
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

// URL-based import map entries (esm.sh, deno.land, etc.)
const urlImportMap: Record<string, string> = {};
function addUrlImports(denoImports: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(denoImports || {})) {
    if (typeof value !== "string") continue;
    if (value.startsWith("http://") || value.startsWith("https://")) {
      urlImportMap[key] = value;
    }
  }
}

try {
  const denoJsonPath = resolve(projectRoot, "deno.json");
  const denoJson = JSON.parse(readFileSync(denoJsonPath, "utf-8"));
  addUrlImports(denoJson.imports);
} catch {
  // Ignore missing or invalid deno.json
}

try {
  const cwdDenoJsonPath = resolve(process.cwd(), "deno.json");
  const cwdDenoJson = JSON.parse(readFileSync(cwdDenoJsonPath, "utf-8"));
  addUrlImports(cwdDenoJson.imports);
} catch {
  // Ignore missing or invalid cwd deno.json
}

function resolveImport(specifier: string): string | null {
  // Direct match
  if (importMap[specifier]) {
    return resolve(projectRoot, importMap[specifier]);
  }

  // Prefix match for @veryfront/*
  if (specifier.startsWith("@veryfront/")) {
    // Try common patterns
    const subpath = specifier.replace("@veryfront/", "");
    const candidates = [
      `./src/${subpath}.ts`,
      `./src/${subpath}/index.ts`,
      `./src/${subpath.replace(/\//g, "/")}.ts`,
    ];

    for (const candidate of candidates) {
      const fullPath = resolve(projectRoot, candidate);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

function resolveUrlImport(specifier: string): string | null {
  // Direct match
  if (urlImportMap[specifier]) return urlImportMap[specifier];

  // Prefix match with wildcard
  for (const [prefix, target] of Object.entries(urlImportMap)) {
    if (prefix.endsWith("/*") && specifier.startsWith(prefix.slice(0, -1))) {
      const suffix = specifier.slice(prefix.length - 1);
      return target.replace("*", suffix);
    }
  }

  // Prefix match without wildcard
  for (const [prefix, target] of Object.entries(urlImportMap)) {
    if (prefix.endsWith("/") && !prefix.endsWith("/*") && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

const HTTP_NAMESPACE = "vf-http";
const httpCache = new Map<string, string>();
const HTTP_CACHE_DIR = join(tmpdir(), "veryfront-http-cache");

function getHttpCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function getHttpCachePath(url: string): string {
  let ext = ".mjs";
  try {
    const pathname = new URL(url).pathname;
    const pathExt = extname(pathname);
    if (pathExt) ext = pathExt;
  } catch {
    // Ignore URL parse errors, keep default extension
  }
  return join(HTTP_CACHE_DIR, `${getHttpCacheKey(url)}${ext}`);
}

function readFromHttpCache(url: string): string | null {
  try {
    return readFileSync(getHttpCachePath(url), "utf-8");
  } catch {
    return null;
  }
}

function writeToHttpCache(url: string, contents: string): void {
  try {
    mkdirSync(HTTP_CACHE_DIR, { recursive: true });
    writeFileSync(getHttpCachePath(url), contents, "utf-8");
  } catch {
    // Best-effort cache write
  }
}

plugin({
  name: "veryfront-resolver",
  setup(build) {
    // Treat file:// URLs with query params as distinct modules (cache busting).
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
      const loader = extension === ".ts"
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

    // Handle HTTP(S) URL imports
    build.onResolve({ filter: /^https?:\/\// }, (args) => ({
      path: args.path,
      namespace: HTTP_NAMESPACE,
    }));

    // Resolve URL-relative and bare imports inside HTTP modules
    build.onResolve({ filter: /.*/, namespace: HTTP_NAMESPACE }, (args) => {
      if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
        return { path: args.path, namespace: HTTP_NAMESPACE };
      }
      if (
        args.path.startsWith("./") ||
        args.path.startsWith("../") ||
        args.path.startsWith("/")
      ) {
        try {
          const resolved = new URL(args.path, args.importer).toString();
          return { path: resolved, namespace: HTTP_NAMESPACE };
        } catch {
          return undefined;
        }
      }
      if (
        args.path.startsWith("node:") ||
        args.path.startsWith("bun:") ||
        args.path.startsWith("data:") ||
        args.path.startsWith("file:")
      ) {
        return { path: args.path };
      }
      const mapped = resolveUrlImport(args.path);
      return {
        path: mapped ?? `https://esm.sh/${args.path}`,
        namespace: HTTP_NAMESPACE,
      };
    });

    // Apply URL import map for bare specifiers in local modules
    build.onResolve({ filter: /.*/ }, (args) => {
      if (
        args.path.startsWith("http://") ||
        args.path.startsWith("https://") ||
        args.path.startsWith("./") ||
        args.path.startsWith("../") ||
        args.path.startsWith("/") ||
        args.path.startsWith("node:") ||
        args.path.startsWith("bun:") ||
        args.path.startsWith("data:") ||
        args.path.startsWith("file:") ||
        args.path.startsWith("@veryfront/") ||
        args.path.startsWith("@std/")
      ) {
        return undefined;
      }
      const mapped = resolveUrlImport(args.path);
      if (mapped) {
        return { path: mapped, namespace: HTTP_NAMESPACE };
      }
      return undefined;
    });

    // Fetch HTTP modules on demand
    build.onLoad({ filter: /.*/, namespace: HTTP_NAMESPACE }, async (args) => {
      const cached = httpCache.get(args.path) ?? readFromHttpCache(args.path);
      if (cached) {
        httpCache.set(args.path, cached);
        return { contents: cached, loader: "js" };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const res = await fetch(args.path, {
          headers: {
            Accept: "application/javascript, text/javascript, */*",
            "User-Agent": "veryfront-bun-loader/1.0",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return {
            errors: [{
              text: `Failed to fetch ${args.path}: ${res.status} ${res.statusText}`,
            }],
          };
        }

        const contents = await res.text();
        httpCache.set(args.path, contents);
        writeToHttpCache(args.path, contents);
        return { contents, loader: "js" };
      } catch (error) {
        clearTimeout(timeout);
        return {
          errors: [{
            text: `Network error fetching ${args.path}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }],
        };
      }
    });
  },
});
