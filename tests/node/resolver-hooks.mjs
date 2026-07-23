/**
 * Minimal Node.js ESM resolver hooks for TypeScript extension resolution.
 *
 * This hook handles:
 * 1. TypeScript extension resolution (.ts, .tsx, index.ts)
 * 2. npm: protocol stripping (for Deno compat)
 * 3. Import aliasing from the nearest deno.json (#veryfront/*, #std/*, #deno-config)
 * 4. React package fallbacks from ./npm/node_modules for Node tests
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  dirname,
  isAbsolute as pathIsAbsolute,
  relative as pathRelative,
  resolve as pathResolve,
  sep as pathSeparator,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, "../..");
const generatedJsrRoot = pathResolve(projectRoot, "npm/esm/deps/jsr.io");

const importMap = {};

const stdImportMap = {
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

const reactImportMap = {
  react: "./npm/node_modules/react/index.js",
  "react/jsx-runtime": "./npm/node_modules/react/jsx-runtime.js",
  "react/jsx-dev-runtime": "./npm/node_modules/react/jsx-dev-runtime.js",
  "react-dom": "./npm/node_modules/react-dom/index.js",
  "react-dom/client": "./npm/node_modules/react-dom/client.js",
  "react-dom/server": "./npm/node_modules/react-dom/server.node.js",
  "react-dom/static": "./npm/node_modules/react-dom/static.node.js",
};

const fallbackAliasMap = {
  "#deno-config": "./deno.json",
  ...stdImportMap,
  ...reactImportMap,
};

try {
  const denoJsonPath = pathResolve(projectRoot, "deno.json");
  const denoJson = JSON.parse(readFileSync(denoJsonPath, "utf-8"));
  for (const [key, value] of Object.entries(denoJson.imports || {})) {
    if (typeof value === "string") importMap[key] = value;
  }
} catch (e) {
  console.warn("Could not read deno.json:", e.message);
}

function normalizeStdSpecifier(specifier) {
  if (specifier.startsWith("@std/")) return `#std/${specifier.slice("@std/".length)}`;
  if (specifier.startsWith("std/")) return `#std/${specifier.slice("std/".length)}`;
  return specifier;
}

function resolveStdCompatTarget(specifier) {
  const normalized = normalizeStdSpecifier(specifier);
  if (stdImportMap[normalized]) return stdImportMap[normalized];
  if (stdImportMap[`${normalized}.ts`]) return stdImportMap[`${normalized}.ts`];
  if (normalized.startsWith("#std/")) {
    const subpath = normalized.slice("#std/".length);
    return `./src/platform/compat/std/${subpath}.ts`;
  }
  return null;
}

function resolveFromImportMap(specifier, imports = importMap) {
  // 1. Direct match (highest priority)
  if (imports[specifier]) {
    return imports[specifier];
  }

  // 2. Longest prefix match, including the harness's legacy wildcard form.
  const prefixEntries = Object.entries(imports).sort(([left], [right]) =>
    right.length - left.length
  );
  for (const [prefix, target] of prefixEntries) {
    if (prefix.endsWith("/*") && specifier.startsWith(prefix.slice(0, -1))) {
      let suffix = specifier.slice(prefix.length - 1);
      // If target ends with *.ts and suffix also ends with .ts, strip .ts from suffix
      if (target.endsWith("*.ts") && suffix.endsWith(".ts")) {
        suffix = suffix.slice(0, -3);
      }
      return target.replaceAll("*", suffix);
    }
    if (prefix.endsWith("/") && !prefix.endsWith("/*") && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

function findActualFile(relativePath, baseDir = projectRoot) {
  const fullPath = pathResolve(baseDir, relativePath);
  if (!isWithinPath(projectRoot, fullPath)) return null;

  const tryPaths = [
    fullPath,
    `${fullPath}.ts`,
    `${fullPath}.tsx`,
    `${fullPath}.js`,
    `${fullPath}.mjs`,
    `${fullPath}.cjs`,
    `${fullPath}.json`,
    pathResolve(fullPath, "index.ts"),
    pathResolve(fullPath, "index.tsx"),
    pathResolve(fullPath, "index.js"),
    pathResolve(fullPath, "index.mjs"),
    pathResolve(fullPath, "index.cjs"),
  ];

  for (const filePath of tryPaths) {
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return filePath;
    }
  }

  return null;
}

function isWithinPath(root, candidate) {
  const relative = pathRelative(root, candidate);
  return relative === "" || (!pathIsAbsolute(relative) && relative !== ".." &&
    !relative.startsWith(`..${pathSeparator}`));
}

const denoImportMapCache = new Map();
const nearestDenoImportMapCache = new Map();

function readDenoImportMap(configPath) {
  if (denoImportMapCache.has(configPath)) return denoImportMapCache.get(configPath);

  let result = null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    const imports = {};
    if (parsed.imports && typeof parsed.imports === "object") {
      for (const [key, value] of Object.entries(parsed.imports)) {
        if (typeof value === "string") imports[key] = value;
      }
    }
    result = { baseDir: dirname(configPath), imports };
  } catch {
    // Invalid or unreadable local configs are left to Node's normal resolution.
  }

  denoImportMapCache.set(configPath, result);
  return result;
}

function findNearestDenoImportMap(parentURL) {
  if (typeof parentURL !== "string" || !parentURL.startsWith("file:")) return null;

  let startDir;
  try {
    startDir = dirname(fileURLToPath(parentURL));
  } catch {
    return null;
  }
  if (!isWithinPath(projectRoot, startDir)) return null;

  const visited = [];
  let currentDir = startDir;
  while (isWithinPath(projectRoot, currentDir)) {
    if (nearestDenoImportMapCache.has(currentDir)) {
      const cached = nearestDenoImportMapCache.get(currentDir);
      for (const directory of visited) nearestDenoImportMapCache.set(directory, cached);
      return cached;
    }

    visited.push(currentDir);
    const configPath = pathResolve(currentDir, "deno.json");
    if (existsSync(configPath) && statSync(configPath).isFile()) {
      const found = readDenoImportMap(configPath);
      if (found) {
        for (const directory of visited) nearestDenoImportMapCache.set(directory, found);
        return found;
      }
    }

    if (currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  for (const directory of visited) nearestDenoImportMapCache.set(directory, null);
  return null;
}

function resolveGeneratedJsrTarget(specifier) {
  const match =
    /^jsr:(@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)@([A-Za-z0-9.+_-]+)(?:\/([A-Za-z0-9._/-]+))?$/.exec(
      specifier,
    );
  if (!match) return null;

  const [, packageName, version, rawSubpath] = match;
  const subpath = rawSubpath ?? "mod";
  const segments = [...packageName.split("/"), version, ...subpath.split("/")];
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const target = pathResolve(generatedJsrRoot, packageName, version, subpath);
  if (!isWithinPath(generatedJsrRoot, target)) return null;
  return findActualFile(pathRelative(projectRoot, target));
}

function stripNpmVersion(packageSpecifier) {
  const versionIndex = packageSpecifier.startsWith("@")
    ? packageSpecifier.indexOf("@", packageSpecifier.indexOf("/") + 1)
    : packageSpecifier.indexOf("@");
  if (versionIndex < 0) return packageSpecifier;

  const subpathIndex = packageSpecifier.indexOf("/", versionIndex);
  return packageSpecifier.slice(0, versionIndex) +
    (subpathIndex < 0 ? "" : packageSpecifier.slice(subpathIndex));
}

function esmShPackageSpecifier(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" || (url.hostname !== "esm.sh" && url.hostname !== "esm.veryfront.com")
  ) {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/^\/(?:v\d+|stable)\//, "/");
  } catch {
    return null;
  }
  const match = pathname.startsWith("/@")
    ? /^\/(@[^/]+\/[^/@]+)@[^/]+(\/.*)?$/.exec(pathname)
    : /^\/([^/@]+)@[^/]+(\/.*)?$/.exec(pathname);
  if (!match?.[1]) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

function mappedImportTarget(specifier, parentURL) {
  const stdNormalized = normalizeStdSpecifier(specifier);
  const nearest = findNearestDenoImportMap(parentURL);
  const localTarget = nearest
    ? resolveFromImportMap(specifier, nearest.imports) ??
      resolveFromImportMap(stdNormalized, nearest.imports)
    : null;
  if (localTarget) return { target: localTarget, baseDir: nearest.baseDir };

  const mapped = resolveFromImportMap(specifier) ?? resolveFromImportMap(stdNormalized);
  if (mapped) return { target: mapped, baseDir: projectRoot };

  const fallback = fallbackAliasMap[specifier] ?? fallbackAliasMap[stdNormalized];
  return fallback ? { target: fallback, baseDir: projectRoot } : null;
}

function resolveAliasSpecifier(specifier, parentURL) {
  const mapped = mappedImportTarget(specifier, parentURL);
  if (!mapped) return null;
  const { target, baseDir } = mapped;

  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/")) {
    return findActualFile(target, baseDir);
  }

  if (target.startsWith("jsr:@std/")) {
    const stdTarget = resolveStdCompatTarget(specifier);
    const localTarget = stdTarget ? findActualFile(stdTarget.replace(/^\.\//, "")) : null;
    return localTarget ?? resolveGeneratedJsrTarget(target);
  }

  const esmShSpecifier = esmShPackageSpecifier(target);
  if (esmShSpecifier) {
    return { packageName: esmShSpecifier };
  }

  if (target.startsWith("npm:")) {
    return { packageName: stripNpmVersion(target.slice(4)) };
  }

  return null;
}

function resolveJsrStdSpecifier(specifier) {
  if (!specifier.startsWith("jsr:@std/")) return null;
  const jsrSubpath = specifier.slice("jsr:@std/".length);
  const normalizedSubpath = jsrSubpath.replace(/@[^/]+/, "");
  const stdSpecifier = `#std/${normalizedSubpath}`;
  const stdTarget = resolveStdCompatTarget(stdSpecifier);
  const localTarget = stdTarget ? findActualFile(stdTarget.replace(/^\.\//, "")) : null;
  return localTarget ?? resolveGeneratedJsrTarget(specifier);
}

export async function resolve(specifier, context, nextResolve) {
  // Strip query strings from specifier for matching
  let cleanSpecifier = specifier;
  let querySuffix = "";
  const queryIndex = specifier.indexOf("?");
  if (queryIndex > 0) {
    cleanSpecifier = specifier.slice(0, queryIndex);
    querySuffix = specifier.slice(queryIndex);
  }

  const jsrStdPath = resolveJsrStdSpecifier(cleanSpecifier);
  if (jsrStdPath) {
    return {
      shortCircuit: true,
      url: pathToFileURL(jsrStdPath).href + querySuffix,
    };
  }

  // Handle npm: protocol (Deno-specific) -> strip npm: prefix
  if (cleanSpecifier.startsWith("npm:")) {
    return nextResolve(stripNpmVersion(cleanSpecifier.slice(4)), context);
  }

  const resolvedAlias = resolveAliasSpecifier(cleanSpecifier, context.parentURL);
  if (resolvedAlias) {
    if (typeof resolvedAlias === "object" && "packageName" in resolvedAlias) {
      return nextResolve(resolvedAlias.packageName, context);
    }
    if (typeof resolvedAlias === "string") {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolvedAlias).href + querySuffix,
      };
    }
  }

  // Fallback for bare React imports in Node test runtime.
  if (reactImportMap[cleanSpecifier]) {
    const actualPath = findActualFile(reactImportMap[cleanSpecifier].replace(/^\.\//, ""));
    if (actualPath) {
      return {
        shortCircuit: true,
        url: pathToFileURL(actualPath).href + querySuffix,
      };
    }
  }

  // Let Node.js handle everything else.
  return nextResolve(specifier, context);
}

// Lazy-load esbuild for TSX transformation
let esbuild = null;
async function getEsbuild() {
  if (!esbuild) {
    esbuild = await import("esbuild");
  }
  return esbuild;
}

/**
 * Custom load hook for TypeScript/TSX/JSX files.
 * Node's --experimental-strip-types doesn't support enums and other advanced TS features.
 * We use esbuild for full TypeScript transformation.
 */
export async function load(url, context, nextLoad) {
  // Only handle file:// URLs
  if (!url.startsWith("file://")) {
    return nextLoad(url, context);
  }

  const filePath = fileURLToPath(url);

  // Handle JSON files (Node requires import attributes for JSON)
  if (filePath.endsWith(".json")) {
    const source = readFileSync(filePath, "utf-8");
    return {
      shortCircuit: true,
      format: "json",
      source,
    };
  }

  // Determine the loader based on file extension
  let loader = null;
  if (filePath.endsWith(".tsx")) {
    loader = "tsx";
  } else if (filePath.endsWith(".ts") && !filePath.endsWith(".d.ts")) {
    loader = "ts";
  } else if (filePath.endsWith(".jsx")) {
    loader = "jsx";
  }

  // Transform TypeScript/TSX/JSX files with esbuild
  if (loader) {
    const source = readFileSync(filePath, "utf-8");
    const esb = await getEsbuild();

    const result = await esb.transform(source, {
      loader,
      format: "esm",
      sourcefile: filePath,
      jsx: "automatic",
      jsxImportSource: "react",
      target: "node20",
    });

    return {
      shortCircuit: true,
      format: "module",
      source: result.code,
    };
  }

  // Let Node handle everything else
  return nextLoad(url, context);
}
