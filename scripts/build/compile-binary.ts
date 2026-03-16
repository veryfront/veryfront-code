#!/usr/bin/env -S deno run --allow-all
/**
 * Compile the Veryfront CLI binary with all required embedded assets.
 *
 * This centralizes deno compile arguments so local builds, CI, and binary
 * tests all embed the same Kreuzberg WASM assets.
 */

import { parseArgs } from "jsr:@std/cli/parse-args";
import { fromFileUrl, isAbsolute, join } from "#std/path.ts";
import { getBinaryPluginBundleIncludes } from "../../src/build/binary-plugin-includes.ts";

const PROJECT_ROOT = fromFileUrl(new URL("../..", import.meta.url));
const DEFAULT_INCLUDES = [
  "src/platform/polyfills",
  "src/proxy/main.ts",
  "dist/framework-src",
];
interface CompileBinaryOptions {
  entrypoint: string;
  extraIncludes: string[];
  output: string;
  target?: string;
}

/**
 * Resolve the kreuzberg WASM assets that must be embedded in the compiled binary.
 *
 * NOTE: This runs under `deno run` (not compiled), so `import.meta.resolve`
 * returns a `file:` URL pointing into `node_modules`. It will NOT work inside
 * a compiled binary — only call this at build time.
 */
export function resolveKreuzbergCompileIncludes(): string[] {
  const resolved = import.meta.resolve("#kreuzberg-wasm-glue");
  if (!resolved.startsWith("file:")) {
    throw new Error(
      `Expected #kreuzberg-wasm-glue to resolve to a file: URL, got: ${resolved}`,
    );
  }
  const glueUrl = new URL(resolved);
  return [
    fromFileUrl(new URL("kreuzberg_wasm_bg.wasm", glueUrl)),
    fromFileUrl(new URL("../pdfium.esm.wasm", glueUrl)),
  ];
}

export function createCompileArgs(options: CompileBinaryOptions): string[] {
  const args = [
    "compile",
    "--allow-all",
    "--unstable-net",
  ];

  for (const include of [
    ...DEFAULT_INCLUDES,
    ...getBinaryPluginBundleIncludes(),
    ...resolveKreuzbergCompileIncludes(),
    ...options.extraIncludes,
  ]) {
    args.push("--include", include);
  }

  if (options.target) {
    args.push("--target", options.target);
  }

  args.push("--output", options.output, options.entrypoint);
  return args;
}

export async function compileBinary(options: CompileBinaryOptions): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: createCompileArgs(options),
    cwd: PROJECT_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) {
    throw new Error(`deno compile failed with exit code ${result.code}`);
  }
}

function normalizeOutputPath(path: string): string {
  return isAbsolute(path) ? path : join(PROJECT_ROOT, path);
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["entrypoint", "include", "output", "target"],
    collect: ["include"],
    default: { entrypoint: "cli/main.ts" },
  });

  if (typeof args.output !== "string" || !args.output) {
    throw new Error("Missing required --output <path>");
  }

  const extraIncludes = (args.include as string[]).map(String);

  try {
    await compileBinary({
      entrypoint: String(args.entrypoint),
      extraIncludes,
      output: normalizeOutputPath(args.output),
      target: typeof args.target === "string" ? args.target : undefined,
    });
  } catch (error) {
    console.error(String(error));
    Deno.exit(1);
  }
}
