/**
 * Minimal Node.js ESM resolver hooks for TypeScript extension resolution.
 *
 * This hook handles:
 * 1. TypeScript extension resolution (.ts, .tsx, index.ts)
 * 2. npm: protocol stripping (for Deno compat)
 * 3. Import aliasing from deno.json (#veryfront/*, #std/*, #deno-config)
 * 4. React package fallbacks from ./npm/node_modules for Node tests
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, "../..");

const importMap = {};
const workspacePackages = [];

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

let rootDenoJson = null;
try {
  const denoJsonPath = pathResolve(projectRoot, "deno.json");
  rootDenoJson = JSON.parse(readFileSync(denoJsonPath, "utf-8"));
  for (const [key, value] of Object.entries(rootDenoJson.imports || {})) {
    if (typeof value === "string") importMap[key] = value;
  }
} catch (e) {
  console.warn("Could not read deno.json:", e.message);
}

for (const workspaceEntry of rootDenoJson?.workspace || []) {
  if (typeof workspaceEntry !== "string") continue;
  const directory = pathResolve(projectRoot, workspaceEntry);
  try {
    const config = JSON.parse(readFileSync(pathResolve(directory, "deno.json"), "utf-8"));
    if (typeof config.name !== "string" || !config.name) continue;
    workspacePackages.push({
      directory,
      exports: config.exports,
      imports: Object.fromEntries(
        Object.entries(config.imports || {}).filter(([, value]) => typeof value === "string"),
      ),
      name: config.name,
    });
  } catch (error) {
    console.warn(`Could not read workspace config for ${workspaceEntry}:`, error.message);
  }
}

workspacePackages.sort((a, b) => b.directory.length - a.directory.length);

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

function resolveFromImportMap(specifier, imports) {
  // 1. Direct match (highest priority)
  if (imports[specifier]) {
    return imports[specifier];
  }

  // 2. Prefix match with wildcard (e.g., #veryfront/testing/* -> ./src/testing/*.ts)
  for (const [prefix, target] of Object.entries(imports)) {
    if (prefix.endsWith("/*") && specifier.startsWith(prefix.slice(0, -1))) {
      let suffix = specifier.slice(prefix.length - 1);
      // If target ends with *.ts and suffix also ends with .ts, strip .ts from suffix
      if (target.endsWith("*.ts") && suffix.endsWith(".ts")) {
        suffix = suffix.slice(0, -3);
      }
      return target.replaceAll("*", suffix);
    }
  }

  // 3. Prefix match without wildcard (e.g., #veryfront/ -> ./src/)
  for (const [prefix, target] of Object.entries(imports)) {
    if (prefix.endsWith("/") && !prefix.endsWith("/*") && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

function findActualFile(relativePath, baseDirectory = projectRoot) {
  const fullPath = pathResolve(baseDirectory, relativePath);

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

function workspaceForParent(parentURL) {
  if (!parentURL?.startsWith("file://")) return null;
  let parentPath;
  try {
    parentPath = fileURLToPath(parentURL);
  } catch {
    return null;
  }
  return workspacePackages.find(({ directory }) =>
    parentPath === directory || parentPath.startsWith(`${directory}${sep}`)
  ) ?? null;
}

function stringExportTarget(exports, exportKey) {
  if (typeof exports === "string") return exportKey === "." ? exports : null;
  if (!exports || typeof exports !== "object") return null;
  const target = exports[exportKey];
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  for (const condition of ["import", "default", "node"]) {
    if (typeof target[condition] === "string") return target[condition];
  }
  return null;
}

function resolveWorkspacePackage(specifier) {
  for (const workspace of workspacePackages) {
    if (specifier !== workspace.name && !specifier.startsWith(`${workspace.name}/`)) continue;
    const subpath = specifier.slice(workspace.name.length);
    const exportKey = subpath ? `.${subpath}` : ".";
    const target = stringExportTarget(workspace.exports, exportKey);
    if (!target) return null;
    return findActualFile(target, workspace.directory);
  }
  return null;
}

function stripNpmVersion(npmSpecifier) {
  const firstSlash = npmSpecifier.indexOf("/");
  const slashAfterName = npmSpecifier.startsWith("@")
    ? npmSpecifier.indexOf("/", firstSlash + 1)
    : firstSlash;
  const packageAndVersion = slashAfterName === -1
    ? npmSpecifier
    : npmSpecifier.slice(0, slashAfterName);
  const subpath = slashAfterName === -1 ? "" : npmSpecifier.slice(slashAfterName);
  const versionIndex = packageAndVersion.indexOf("@", packageAndVersion.startsWith("@") ? 1 : 0);
  const packageName = versionIndex === -1
    ? packageAndVersion
    : packageAndVersion.slice(0, versionIndex);
  return `${packageName}${subpath}`;
}

function resolveReactTarget(target) {
  if (!target.startsWith("https://esm.sh/")) return null;
  const pathname = new URL(target).pathname.slice(1);
  for (const packageName of ["react-dom", "react"]) {
    if (!pathname.startsWith(`${packageName}@`)) continue;
    const slashIndex = pathname.indexOf("/");
    const subpath = slashIndex === -1 ? "" : pathname.slice(slashIndex);
    const mapped = reactImportMap[`${packageName}${subpath}`];
    return mapped ? findActualFile(mapped) : null;
  }
  return null;
}

function resolveVendoredJsrTarget(target) {
  const match = target.match(/^jsr:(@[^/]+\/[^@/]+)@([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  const [, packageName, version, subpath = "mod"] = match;
  return findActualFile(`npm/esm/deps/jsr.io/${packageName}/${version}/${subpath}.js`) ??
    findActualFile(`npm/src/deps/jsr.io/${packageName}/${version}/${subpath}.ts`);
}

function resolveAliasSpecifier(specifier, parentURL) {
  const stdNormalized = normalizeStdSpecifier(specifier);
  const workspace = workspaceForParent(parentURL);
  const workspaceMapped = workspace
    ? resolveFromImportMap(specifier, workspace.imports) ??
      resolveFromImportMap(stdNormalized, workspace.imports)
    : null;
  const rootMapped = resolveFromImportMap(specifier, importMap) ??
    resolveFromImportMap(stdNormalized, importMap);
  const mapped = workspaceMapped ?? rootMapped;
  const fallback = fallbackAliasMap[specifier] ?? fallbackAliasMap[stdNormalized];
  const target = mapped ?? fallback;

  if (!target) return null;

  if (target.startsWith("./") || target.startsWith("../")) {
    const baseDirectory = workspaceMapped ? workspace.directory : projectRoot;
    return findActualFile(target, baseDirectory);
  }

  if (target.startsWith("jsr:@std/")) {
    const stdTarget = resolveStdCompatTarget(specifier);
    const compatPath = stdTarget ? findActualFile(stdTarget) : null;
    return compatPath ?? resolveVendoredJsrTarget(target);
  }

  if (target.startsWith("https://esm.sh/react") || target.startsWith("npm:react")) {
    const reactTarget = reactImportMap[specifier] ?? reactImportMap[stdNormalized];
    return resolveReactTarget(target) ?? (reactTarget ? findActualFile(reactTarget) : null);
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
  const compatPath = stdTarget ? findActualFile(stdTarget) : null;
  return compatPath ?? resolveVendoredJsrTarget(specifier);
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
    const packageSpec = cleanSpecifier.slice(4);
    const atIndex = packageSpec.indexOf("@", 1);
    const packageName = atIndex > 0 ? packageSpec.slice(0, atIndex) : packageSpec;
    return nextResolve(packageName, context);
  }

  const workspacePackage = resolveWorkspacePackage(cleanSpecifier);
  if (workspacePackage) {
    return {
      shortCircuit: true,
      url: pathToFileURL(workspacePackage).href + querySuffix,
    };
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
