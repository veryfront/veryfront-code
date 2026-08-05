#!/usr/bin/env -S deno run --allow-all
/**
 * Compile the Veryfront CLI binary with all required embedded assets.
 */

import { parseArgs } from "#std/flags";
import { fromFileUrl, isAbsolute, join } from "#std/path.ts";

const PROJECT_ROOT = fromFileUrl(new URL("../..", import.meta.url));
export const DEFAULT_INCLUDES = [
  "src/platform/polyfills",
  "src/proxy/main.ts",
  "src/security/sandbox/worker-script.ts",
  // Spawned through a computed sibling URL in
  // src/config/declarative-evaluator-worker-runner.ts, which compile cannot
  // trace. Without this the binary boots and only fails when the declarative
  // config evaluator first runs, and the unhandled child-worker error takes
  // the process down instead of failing the single request.
  "src/config/declarative-evaluator-worker-entry.ts",
  "extensions/ext-auth-jwt/src/index.ts",
  // Explicit extensions remain inert until selected. Default extensions are
  // activated by the normal builtin composition when their source is embedded.
  "extensions/ext-blob-gcs/src/index.ts",
  "extensions/ext-blob-s3/src/index.ts",
  "extensions/ext-node-websocket-ws/src/index.ts",
  "extensions/ext-bundler-esbuild/src/index.ts",
  "extensions/ext-cache-redis/src/index.ts",
  "extensions/ext-redis/src/index.ts",
  "extensions/ext-content-mdx/src/index.ts",
  "extensions/ext-css-lightning/src/index.ts",
  "extensions/ext-css-purgecss/src/index.ts",
  "extensions/ext-css-tailwind/src/index.ts",
  "extensions/ext-db-sqlite/src/index.ts",
  "extensions/ext-dev-ui-react/src/index.ts",
  "extensions/ext-document-kreuzberg/src/index.ts",
  "extensions/ext-eval-report-http/src/index.ts",
  "extensions/ext-eval-report-mlflow/src/index.ts",
  "extensions/ext-image-sharp/src/index.ts",
  "extensions/ext-observability-opentelemetry/src/index.ts",
  "extensions/ext-observability-sentry/src/index.ts",
  "extensions/ext-parser-babel/src/index.ts",
  "extensions/ext-parser-babel/src/parser-only.ts",
  "extensions/ext-react-ssr/src/index.ts",
  // Resolved through a computed sibling URL at runtime, so compile cannot
  // discover either the worker entrypoint or its embedded renderer payload.
  "extensions/ext-react-ssr/src/worker-renderer.ts",
  "extensions/ext-react-ssr/src/worker-renderer-bundle.generated.ts",
  "extensions/ext-yaml/src/index.ts",
  "extensions/ext-sandbox-shell-tools/src/index.ts",
  // Spawned via `new Worker(new URL(...))`, which deno compile does not trace.
  "extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts",
  "extensions/ext-document-kreuzberg/src/native-progress-extraction-worker.ts",
  "src/rendering/rsc",
  "src/utils/clsx.ts",
  "dist/framework-src",
];

export const PROXY_INCLUDES = [
  // The proxy runtime is loaded after provider activation. Providers are
  // statically referenced by cli/proxy-main.ts so --include does not embed the
  // workspace file tree for each extension.
  "src/proxy/main.ts",
];

export type CompileBinaryProfile = "full" | "proxy";

interface CompileBinaryOptions {
  entrypoint?: string;
  extraIncludes: string[];
  output: string;
  profile?: CompileBinaryProfile;
  target?: string;
}

function includesForProfile(profile: CompileBinaryProfile): string[] {
  return profile === "proxy" ? PROXY_INCLUDES : DEFAULT_INCLUDES;
}

export function createCompileArgs(options: CompileBinaryOptions): string[] {
  const profile = options.profile ?? "full";
  const args = [
    "compile",
    "--allow-all",
    "--unstable-net",
    "--unstable-worker-options",
  ];

  if (profile === "proxy") {
    // The workspace lock contains every framework dependency, and Deno embeds
    // every locked npm package in a compiled binary. Use the graph-specific
    // frozen lock so the proxy carries only its statically anchored providers.
    // Refresh it with `deno task build:proxy-lock` after provider changes.
    args.push(
      "--node-modules-dir=none",
      "--lock",
      "scripts/build/proxy-deno.lock",
      "--frozen",
    );
  }

  for (const include of [
    ...includesForProfile(profile),
    ...options.extraIncludes,
  ]) {
    args.push("--include", include);
  }

  if (options.target) {
    args.push("--target", options.target);
  }

  const entrypoint = options.entrypoint ??
    (profile === "proxy" ? "cli/proxy-main.ts" : "cli/main.ts");
  args.push("--output", options.output, entrypoint);
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
    string: ["entrypoint", "include", "output", "profile", "target"],
    collect: ["include"],
  });

  if (typeof args.output !== "string" || !args.output) {
    throw new Error("Missing required --output <path>");
  }

  const extraIncludes = (args.include as string[]).map(String);
  const profile = args.profile ?? "full";
  if (profile !== "full" && profile !== "proxy") {
    throw new Error(`Invalid --profile ${profile}; expected full or proxy`);
  }

  try {
    await compileBinary({
      entrypoint: typeof args.entrypoint === "string" ? args.entrypoint : undefined,
      extraIncludes,
      output: normalizeOutputPath(args.output),
      profile,
      target: typeof args.target === "string" ? args.target : undefined,
    });
  } catch (error) {
    console.error(String(error));
    Deno.exit(1);
  }
}
