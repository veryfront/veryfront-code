import { replaceSpecifiers } from "./lexer.ts";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { isNodeRuntime } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

/**
 * Get the absolute path to the veryfront AI React module for Deno SSR.
 * This resolves relative to this file's location in the veryfront source tree.
 */
function getVeryfrontAIReactPath(subpath: string = ""): string {
  // This file is at: src/build/transforms/esm/react-imports.ts
  // AI react is at: src/ai/react/index.ts
  // So we need to go up 4 levels: esm -> transforms -> build -> src
  const currentDir = new URL(".", import.meta.url).pathname;
  const srcDir = currentDir.replace(/\/build\/transforms\/esm\/?$/, "");
  const modulePath = subpath || "index.ts";
  return `file://${srcDir}/ai/react/${modulePath}`;
}

// Cache whether project has both react and react-dom
let projectHasReactDom: boolean | null = null;

// Cache for resolved Deno npm paths
let denoNpmCacheDir: string | null = null;

async function getDenoNpmCacheDir(): Promise<string | null> {
  if (denoNpmCacheDir !== null) {
    return denoNpmCacheDir;
  }

  try {
    const command = new Deno.Command("deno", {
      args: ["info", "--json"],
      stdout: "piped",
    });
    const { stdout } = await command.output();
    const info = JSON.parse(new TextDecoder().decode(stdout));
    denoNpmCacheDir = info.npmCache || null;
    return denoNpmCacheDir;
  } catch {
    denoNpmCacheDir = null;
    return null;
  }
}

async function resolveDenoNpmPackage(
  packageName: string,
  version: string,
  subpath: string = "",
): Promise<string | null> {
  const cacheDir = await getDenoNpmCacheDir();
  if (!cacheDir) return null;

  const packagePath = `${cacheDir}/registry.npmjs.org/${packageName}/${version}`;
  const filePath = subpath ? `${packagePath}${subpath}.js` : `${packagePath}/index.js`;

  try {
    await Deno.stat(filePath);
    return `file://${filePath}`;
  } catch {
    return null;
  }
}

// Cache for local React resolution
let localReactCache: Record<string, string> | null | undefined = undefined;

async function resolveLocalReact(): Promise<Record<string, string> | null> {
  if (localReactCache !== undefined) {
    return localReactCache;
  }

  const projectDir = cwd();
  const nodeModulesReact = `${projectDir}/node_modules/react`;

  try {
    await Deno.stat(nodeModulesReact);

    // React is installed in node_modules, resolve paths
    const imports: Record<string, string> = {
      "react": `file://${nodeModulesReact}/index.js`,
      "react/jsx-runtime": `file://${nodeModulesReact}/jsx-runtime.js`,
      "react/jsx-dev-runtime": `file://${nodeModulesReact}/jsx-dev-runtime.js`,
      "react-dom": `file://${projectDir}/node_modules/react-dom/index.js`,
      "react-dom/server": `file://${projectDir}/node_modules/react-dom/server.js`,
      "react-dom/client": `file://${projectDir}/node_modules/react-dom/client.js`,
    };

    localReactCache = imports;
    return imports;
  } catch {
    localReactCache = null;
    return null;
  }
}

/**
 * Check if the project has both react and react-dom installed.
 * This is used to determine whether to use project's React or bundled React
 * during SSR to avoid the "multiple React instances" error.
 */
async function checkProjectHasReactDom(): Promise<boolean> {
  if (projectHasReactDom !== null) {
    return projectHasReactDom;
  }

  if (!isNodeRuntime()) {
    projectHasReactDom = false;
    return false;
  }

  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);

    // Check that BOTH can be resolved
    projectRequire.resolve("react");
    projectRequire.resolve("react-dom/server");
    projectHasReactDom = true;
    return true;
  } catch {
    projectHasReactDom = false;
    return false;
  }
}

/**
 * Get the path to the bundled React in the CLI's node_modules.
 * This is used when the project doesn't have react-dom installed.
 */
async function getBundledReactPath(subpath: string = ""): Promise<string | null> {
  if (!isNodeRuntime()) {
    return null;
  }

  try {
    const { createRequire } = await import("node:module");
    const cliRequire = createRequire(import.meta.url);
    const moduleName = subpath ? `react${subpath}` : "react";
    return cliRequire.resolve(moduleName);
  } catch {
    return null;
  }
}

export async function resolveReactImports(code: string, forSSR: boolean = false): Promise<string> {
  const isNode = isNodeRuntime();

  // For Node.js SSR, always resolve to absolute file:// URLs
  // This is required because temp modules can't resolve bare imports
  if (isNode && forSSR) {
    const hasReactDom = await checkProjectHasReactDom();
    const { pathToFileURL } = await import("node:url");

    if (hasReactDom) {
      // Project has react and react-dom, resolve to project's node_modules
      try {
        const { createRequire } = await import("node:module");
        const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);

        const projectImports: Record<string, string> = {
          "react/jsx-runtime": pathToFileURL(projectRequire.resolve("react/jsx-runtime")).href,
          "react/jsx-dev-runtime":
            pathToFileURL(projectRequire.resolve("react/jsx-dev-runtime")).href,
          "react": pathToFileURL(projectRequire.resolve("react")).href,
        };

        return replaceSpecifiers(code, (specifier) => {
          return projectImports[specifier] || null;
        });
      } catch {
        // Fall through to bundled React
      }
    }

    // Project doesn't have react-dom or resolution failed, use bundled React
    const bundledReact = await getBundledReactPath();
    const bundledJsxRuntime = await getBundledReactPath("/jsx-runtime");
    const bundledJsxDevRuntime = await getBundledReactPath("/jsx-dev-runtime");

    if (bundledReact && bundledJsxRuntime && bundledJsxDevRuntime) {
      const bundledImports: Record<string, string> = {
        "react/jsx-runtime": pathToFileURL(bundledJsxRuntime).href,
        "react/jsx-dev-runtime": pathToFileURL(bundledJsxDevRuntime).href,
        "react": pathToFileURL(bundledReact).href,
      };

      return replaceSpecifiers(code, (specifier) => {
        return bundledImports[specifier] || null;
      });
    }

    // Last resort: keep bare imports
    return code;
  }

  // For Node.js (non-SSR), keep bare imports as-is (npm packages)
  if (isNode) {
    return code;
  }

  // For Deno SSR, keep bare imports (react, react/jsx-runtime) since temp files
  // are now in node_modules/.cache which can resolve to parent node_modules.
  // Only transform veryfront-specific imports to file:// URLs.
  if (forSSR) {
    const denoSSRImports: Record<string, string> = {
      "veryfront/ai/react": getVeryfrontAIReactPath(),
      "veryfront/ai/components": getVeryfrontAIReactPath("components/index.ts"),
      "veryfront/ai/primitives": getVeryfrontAIReactPath("primitives/index.ts"),
    };

    return replaceSpecifiers(code, (specifier) => {
      return denoSSRImports[specifier] || null;
    });
  }

  // For Deno/browser, transform to esm.sh URLs
  const reactImports: Record<string, string> = {
    "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
    "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
    "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
  };

  return replaceSpecifiers(code, (specifier) => {
    return reactImports[specifier] || null;
  });
}

export function addDepsToEsmShUrls(code: string, forSSR: boolean = false): Promise<string> {
  // Skip for Node.js - no esm.sh URLs needed
  if (isNodeRuntime()) {
    return Promise.resolve(code);
  }

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("https://esm.sh/") && !specifier.includes(`react@${REACT_DEFAULT_VERSION}`)) {
      // Parse existing query params if any
      const hasQuery = specifier.includes("?");
      const hasExternal = specifier.includes("external=");

      if (forSSR) {
        // For SSR: Use ?external to prevent bundling React
        // This ensures esm.sh packages use our npm:react instance
        if (hasExternal) {
          return null; // Already has external param
        }
        const separator = hasQuery ? "&" : "?";
        return `${specifier}${separator}external=react,react-dom`;
      } else {
        // For browser: Use ?deps to ensure consistent React version
        if (hasQuery) {
          return null; // Already has query params
        }
        return `${specifier}?deps=react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}`;
      }
    }
    return null;
  }));
}
