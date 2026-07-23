#!/usr/bin/env -S deno run --allow-all
/**
 * Pre-bundle RSC Client Scripts for Compiled Binary
 *
 * In `deno compile` builds, esbuild cannot resolve Deno import map specifiers
 * (#veryfront/...) at runtime. This script bundles client-boot.ts and client-dom.ts
 * ahead of time with proper import resolution and writes them into a generated
 * module that script-handlers.ts imports as fallback.
 *
 * Runs as part of `deno task generate`, before `deno compile`.
 */

import { dirname, fromFileUrl, join } from "#std/path.ts";
import * as esbuild from "npm:esbuild@0.28.1";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = join(scriptDir, "..", "..");
const rscDir = join(projectRoot, "src", "rendering", "rsc");
const outputPath = join(
  projectRoot,
  "src",
  "server",
  "services",
  "rsc",
  "endpoints",
  "rsc-bundles.generated.ts",
);

// Read deno.json import map for resolving #veryfront/ specifiers
const denoConfig = JSON.parse(
  await Deno.readTextFile(join(projectRoot, "deno.json")),
);
const importMap: Record<string, string> = denoConfig.imports ?? {};

// Barrel imports that pull in heavy server-side deps. Redirect to the
// specific file that actually contains the export the client scripts need.
const BARREL_OVERRIDES: Record<string, string> = {
  // html-sanitizer.ts only needs SECURITY_VIOLATION — error-registry.ts
  // exports it without pulling in tracing, middleware, OpenTelemetry, etc.
  "#veryfront/errors": "./src/errors/error-registry.ts",
};

function resolveImportMap(specifier: string): string | null {
  // Check barrel overrides first
  if (BARREL_OVERRIDES[specifier]) {
    return join(projectRoot, BARREL_OVERRIDES[specifier]);
  }

  // Exact match
  if (importMap[specifier]) {
    const target = importMap[specifier];
    if (target.startsWith("./")) return join(projectRoot, target);
    return null; // npm: or jsr: — cannot resolve to file
  }

  // Longest prefix match
  let bestKey = "";
  let bestTarget = "";
  for (const [key, value] of Object.entries(importMap)) {
    if (!key.endsWith("/") || !specifier.startsWith(key)) continue;
    if (key.length > bestKey.length) {
      bestKey = key;
      bestTarget = value as string;
    }
  }

  if (bestKey && bestTarget.startsWith("./")) {
    const remainder = specifier.slice(bestKey.length);
    return join(projectRoot, bestTarget, remainder);
  }

  return null;
}

const denoImportMapPlugin: esbuild.Plugin = {
  name: "deno-import-map",
  setup(build) {
    // Resolve Deno import map specifiers (#veryfront/, #std/, etc.)
    build.onResolve({ filter: /^#/ }, (args) => {
      const resolved = resolveImportMap(args.path);
      if (resolved) return { path: resolved };
      return { external: true };
    });

    // Replace Node builtins with browser-safe stubs.
    // These are pulled in transitively by server-side code (logger, platform
    // compat) that the client scripts don't actually exercise at runtime.
    build.onResolve(
      { filter: /^(node:)?async_hooks$/ },
      () => ({ path: "node:async_hooks", namespace: "node-stub" }),
    );
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => {
      if (args.path === "node:async_hooks") {
        return {
          contents: `
            export class AsyncLocalStorage {
              getStore() { return undefined; }
              run(_store, fn, ...args) { return fn(...args); }
              enterWith() {}
              disable() {}
            }
          `,
          loader: "js",
        };
      }
      return { contents: "export default {};", loader: "js" };
    });

    // Replace other Node builtins with empty modules — they're only reached
    // via dynamic import() inside try/catch in platform compat layers.
    build.onResolve(
      { filter: /^node:(fs|os|path|crypto|stream|util|buffer|url|http|https|net|tls|zlib|child_process|worker_threads|perf_hooks|process)(\/.*)?$/ },
      (args) => ({ path: args.path, namespace: "node-empty" }),
    );
    build.onResolve(
      { filter: /^(events|fs|os|path|crypto|stream|util|buffer|url|http|https|net|tls|zlib|child_process|worker_threads|perf_hooks)$/ },
      (args) => ({ path: args.path, namespace: "node-empty" }),
    );
    build.onLoad({ filter: /.*/, namespace: "node-empty" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

async function bundleScript(
  entryPoint: string,
  externals: string[] = [],
): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    treeShaking: true,
    external: externals,
    plugins: [denoImportMapPlugin],
  });
  return result.outputFiles?.[0]?.text ?? "";
}

console.log("[prebundle-rsc-scripts] Bundling client-boot.ts...");
const clientBootBundle = await bundleScript(
  join(rscDir, "client-boot.ts"),
  ["https://esm.sh/*", "/_veryfront/*", "react", "react-dom", "react-dom/*"],
);

console.log("[prebundle-rsc-scripts] Bundling client-dom.ts...");
const clientDomBundle = await bundleScript(join(rscDir, "client-dom.ts"));

const output = `/**
 * Pre-bundled RSC client scripts for compiled binary
 *
 * AUTO-GENERATED by scripts/build/prebundle-rsc-scripts.ts
 * Do not edit manually. Run \`deno task generate\` to regenerate.
 * @module
 */

export const CLIENT_BOOT_BUNDLE: string = ${JSON.stringify(clientBootBundle)};

export const CLIENT_DOM_BUNDLE: string = ${JSON.stringify(clientDomBundle)};
`;

await Deno.writeTextFile(outputPath, output);

const fmtResult = await new Deno.Command("deno", {
  args: ["fmt", outputPath],
  stdout: "null",
  stderr: "piped",
}).output();

if (!fmtResult.success) {
  const err = new TextDecoder().decode(fmtResult.stderr).trim();
  console.warn(`[prebundle-rsc-scripts] Warning: could not format output: ${err}`);
}

esbuild.stop();

console.log(`[prebundle-rsc-scripts] Written to ${outputPath}`);
console.log(`  client-boot: ${(clientBootBundle.length / 1024).toFixed(1)} KB`);
console.log(`  client-dom: ${(clientDomBundle.length / 1024).toFixed(1)} KB`);
