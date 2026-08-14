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
const workspacePackageMap = {};
const workspacePackagePatterns = [];
// Deno applies a workspace member's own `imports` to the modules inside that
// member's directory; the root import map does not contain them. `react/` is
// the case that matters here: its wrappers import `@veryfront/react-*-upstream`,
// which exists only in `react/deno.json`. These scopes are derived from the
// member configs this loader already reads, so a new member entry needs no
// edit here.
export const workspaceImportScopes = [];

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

function registerWorkspaceExport(packageName, exportName, target, workspaceDir) {
  if (typeof target !== "string") return;
  const suffix = exportName === "."
    ? ""
    : exportName.startsWith("./")
    ? `/${exportName.slice(2)}`
    : null;
  if (suffix === null) return;

  const specifier = `${packageName}${suffix}`;
  const absoluteTarget = pathResolve(workspaceDir, target);
  if (specifier.includes("*") && absoluteTarget.includes("*")) {
    const [specifierPrefix, specifierSuffix = ""] = specifier.split("*");
    const [targetPrefix, targetSuffix = ""] = absoluteTarget.split("*");
    workspacePackagePatterns.push({
      specifierPrefix,
      specifierSuffix,
      targetPrefix,
      targetSuffix,
    });
    return;
  }
  if (!specifier.includes("*")) workspacePackageMap[specifier] = absoluteTarget;
}

function registerWorkspaceImports(config, workspaceDir) {
  const imports = config.imports;
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) return;
  const scoped = {};
  for (const [key, value] of Object.entries(imports)) {
    if (typeof value === "string") scoped[key] = value;
  }
  if (Object.keys(scoped).length === 0) return;
  workspaceImportScopes.push({ dir: workspaceDir, imports: scoped });
}

function registerWorkspacePackage(workspaceEntry, registerImportScope = true) {
  if (typeof workspaceEntry !== "string") return;
  const workspaceDir = pathResolve(projectRoot, workspaceEntry);
  try {
    const config = JSON.parse(readFileSync(pathResolve(workspaceDir, "deno.json"), "utf-8"));
    // Registered before the `name`/`exports` guards below: a member can carry
    // imports without publishing exports.
    if (registerImportScope) registerWorkspaceImports(config, workspaceDir);
    if (typeof config.name !== "string" || !config.name) return;
    if (typeof config.exports === "string") {
      registerWorkspaceExport(config.name, ".", config.exports, workspaceDir);
      return;
    }
    if (!config.exports || typeof config.exports !== "object" || Array.isArray(config.exports)) {
      return;
    }
    for (const [exportName, target] of Object.entries(config.exports)) {
      registerWorkspaceExport(config.name, exportName, target, workspaceDir);
    }
  } catch {
    // Invalid workspace metadata is surfaced by the normal Node resolver when
    // a test imports that package; unrelated test files remain runnable.
  }
}

try {
  const denoJsonPath = pathResolve(projectRoot, "deno.json");
  const denoJson = JSON.parse(readFileSync(denoJsonPath, "utf-8"));
  for (const [key, value] of Object.entries(denoJson.imports || {})) {
    if (typeof value === "string") importMap[key] = value;
  }
  registerWorkspacePackage(".", false);
  for (const workspaceEntry of denoJson.workspace || []) {
    registerWorkspacePackage(workspaceEntry);
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

function resolveFromMap(map, specifier) {
  // 1. Direct match (highest priority)
  if (map[specifier]) {
    return map[specifier];
  }

  // 2. Prefix match with wildcard (e.g., #veryfront/testing/* -> ./src/testing/*.ts)
  for (const [prefix, target] of Object.entries(map)) {
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
  for (const [prefix, target] of Object.entries(map)) {
    if (prefix.endsWith("/") && !prefix.endsWith("/*") && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

function resolveFromImportMap(specifier) {
  return resolveFromMap(importMap, specifier);
}

/**
 * The workspace member whose directory contains the importing module, so its
 * import map applies only where Deno would apply it. The deepest match wins
 * when members nest.
 */
export function findWorkspaceImportScope(parentPath, pathSeparator = sep) {
  if (!parentPath) return null;
  let best = null;
  for (const scope of workspaceImportScopes) {
    // `sep`, not a literal "/": both sides come from pathResolve/fileURLToPath,
    // so on Windows they are backslash-separated and a hard-coded slash matches
    // nothing -- every member scope would silently fail to apply.
    if (
      parentPath !== scope.dir && !parentPath.startsWith(`${scope.dir}${pathSeparator}`)
    ) continue;
    if (!best || scope.dir.length > best.dir.length) best = scope;
  }
  return best;
}

/**
 * The bare npm specifier behind a remote target, e.g.
 * `https://esm.sh/react-dom@19.2.4/server?external=react` -> `react-dom/server`.
 * Lets one lookup table cover both the esm.sh URLs Deno uses and `npm:` targets.
 */
export function bareSpecifierFromRemoteTarget(target) {
  let rest = null;
  if (target.startsWith("https://esm.sh/")) rest = target.slice("https://esm.sh/".length);
  else if (target.startsWith("npm:")) rest = target.slice("npm:".length);
  else return null;

  const queryIndex = rest.indexOf("?");
  if (queryIndex >= 0) rest = rest.slice(0, queryIndex);
  const match = /^((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?(\/.*)?$/.exec(rest);
  if (!match) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

function findActualFile(relativePath, baseDir = projectRoot) {
  const fullPath = pathResolve(baseDir, relativePath);

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

function resolveAliasSpecifier(specifier, scope) {
  const stdNormalized = normalizeStdSpecifier(specifier);
  // A member's own map wins inside that member, which is what Deno does and
  // what the member declared it for. Consulting the root first looked
  // conservative but silently resolved the six React specifiers that appear in
  // both maps to the root's targets, so the member's aliases never applied.
  const scoped = scope
    ? resolveFromMap(scope.imports, specifier) ?? resolveFromMap(scope.imports, stdNormalized)
    : null;
  const mapped = scoped
    ? null
    : resolveFromImportMap(specifier) ?? resolveFromImportMap(stdNormalized);
  const fallback = fallbackAliasMap[specifier] ?? fallbackAliasMap[stdNormalized];
  const target = scoped ?? mapped ?? fallback;

  if (!target) return null;

  // A member's relative targets are relative to the member directory.
  const baseDir = scoped ? scope.dir : projectRoot;

  if (target.startsWith("./") || target.startsWith("../")) {
    return findActualFile(target.replace(/^\.\//, ""), baseDir);
  }

  if (target.startsWith("jsr:@std/")) {
    const stdTarget = resolveStdCompatTarget(specifier);
    if (!stdTarget) return null;
    return findActualFile(stdTarget.replace(/^\.\//, ""));
  }

  // React is vendored under ./npm/node_modules for Node tests. Match on the
  // package the target points at, not on the specifier, so the aliases the
  // react workspace member declares (`@veryfront/react-dom-server-upstream` ->
  // esm.sh/react-dom/server) land on the same vendored files.
  const remoteBare = bareSpecifierFromRemoteTarget(target);
  if (remoteBare && reactImportMap[remoteBare]) {
    return findActualFile(reactImportMap[remoteBare].replace(/^\.\//, ""));
  }

  if (target.startsWith("npm:")) {
    // Keep the subpath: `npm:ajv@8/dist/2019.js` is not `ajv`, and the package
    // entry point does not carry the subpath's exports.
    const nodeSpecifier = remoteBare;
    if (!nodeSpecifier) return null;
    return { nodeSpecifier };
  }

  return null;
}

function resolveWorkspacePackage(specifier) {
  const exact = workspacePackageMap[specifier];
  if (exact) return findActualFile(exact);
  for (const pattern of workspacePackagePatterns) {
    if (
      !specifier.startsWith(pattern.specifierPrefix) ||
      !specifier.endsWith(pattern.specifierSuffix)
    ) {
      continue;
    }
    const matched = specifier.slice(
      pattern.specifierPrefix.length,
      specifier.length - pattern.specifierSuffix.length,
    );
    return findActualFile(`${pattern.targetPrefix}${matched}${pattern.targetSuffix}`);
  }
  return null;
}

function resolveJsrStdSpecifier(specifier) {
  if (!specifier.startsWith("jsr:@std/")) return null;
  const jsrSubpath = specifier.slice("jsr:@std/".length);
  const normalizedSubpath = jsrSubpath.replace(/@[^/]+/, "");
  const stdSpecifier = `#std/${normalizedSubpath}`;
  const stdTarget = resolveStdCompatTarget(stdSpecifier);
  if (!stdTarget) return null;
  return findActualFile(stdTarget.replace(/^\.\//, ""));
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

  const workspacePath = resolveWorkspacePackage(cleanSpecifier);
  if (workspacePath) {
    return {
      shortCircuit: true,
      url: pathToFileURL(workspacePath).href + querySuffix,
    };
  }

  // Handle npm: protocol (Deno-specific) -> strip npm: prefix
  if (cleanSpecifier.startsWith("npm:")) {
    const packageSpec = cleanSpecifier.slice(4);
    const atIndex = packageSpec.indexOf("@", 1);
    const packageName = atIndex > 0 ? packageSpec.slice(0, atIndex) : packageSpec;
    return nextResolve(packageName, context);
  }

  const parentPath = typeof context?.parentURL === "string" && context.parentURL.startsWith("file:")
    ? fileURLToPath(context.parentURL)
    : null;
  const resolvedAlias = resolveAliasSpecifier(
    cleanSpecifier,
    findWorkspaceImportScope(parentPath),
  );
  if (resolvedAlias) {
    if (typeof resolvedAlias === "object" && "nodeSpecifier" in resolvedAlias) {
      return nextResolve(resolvedAlias.nodeSpecifier, context);
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
