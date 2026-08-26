#!/usr/bin/env -S deno run --allow-all
/**
 * Compile the Veryfront CLI binary with all required embedded assets.
 */

import { parseArgs } from "#std/flags";
import { fromFileUrl, isAbsolute, join } from "#std/path.ts";

const PROJECT_ROOT = fromFileUrl(new URL("../..", import.meta.url));

/**
 * Worker entrypoints `deno compile` cannot discover.
 *
 * These are spawned through a sibling URL whose extension is computed at
 * runtime. Compile embeds a worker only when it can statically read the
 * specifier, so these are invisible to it and must be listed explicitly.
 *
 * Omitting one fails nothing that runs from source -- the file resolves from
 * disk, so the build and every test pass. The binary then starts, serves
 * traffic, and dies on the first request that spawns the worker. The
 * declarative config evaluator reached production this way and crash-looped it.
 *
 * See PROXY_INCLUDES for why the proxy profile does not carry these.
 */
export const UNTRACEABLE_WORKER_INCLUDES = [
  "src/config/declarative-evaluator-worker-entry.ts",
  "extensions/ext-react-ssr/src/worker-renderer.ts",
  "extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts",
  "extensions/ext-document-kreuzberg/src/native-progress-extraction-worker.ts",
  "extensions/ext-document-kreuzberg/src/native-extraction-process.ts",
];

export const DEFAULT_INCLUDES = [
  ...UNTRACEABLE_WORKER_INCLUDES,
  "src/platform/polyfills",
  "src/proxy/main.ts",
  "src/security/sandbox/worker-script.ts",
  "extensions/ext-auth-jwt/src/index.ts",
  // Explicit extensions remain inert until selected. Default extensions are
  // activated by the normal builtin composition when their source is embedded.
  "extensions/ext-blob-gcs/src/index.ts",
  "extensions/ext-blob-s3/src/index.ts",
  "extensions/ext-node-websocket-ws/src/index.ts",
  "extensions/ext-bundler-esbuild/src/index.ts",
  "extensions/ext-bundler-swc/src/index.ts",
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
  // The renderer payload the worker loads. Not an entrypoint, so it is not in
  // UNTRACEABLE_WORKER_INCLUDES, but compile cannot discover it either.
  "extensions/ext-react-ssr/src/worker-renderer-bundle.generated.ts",
  "extensions/ext-yaml/src/index.ts",
  "extensions/ext-sandbox-shell-tools/src/index.ts",
  "src/rendering/rsc",
  "src/utils/clsx.ts",
  "dist/framework-src",
];

/**
 * V8 flags baked into the full binary at compile time.
 *
 * Compiled binaries ignore the DENO_V8_FLAGS environment variable at runtime,
 * so the production chart's `--max-old-space-size=4096` never reached the
 * release binary: every heap OOM over 30 days died at V8's ~2 GiB default
 * while the manifest verifiably set 4096 (veryfront-issue-inbox#269).
 * `deno compile --v8-flags` serializes the flags into the binary's trailer
 * (`"v8_flags":[...]`), which is the only channel through which a compiled
 * artifact gets them. The baked value is final -- a runtime DENO_V8_FLAGS
 * cannot override it -- so 4096 here IS the production heap ceiling, and the
 * chart's env var is documentation only. Production pods are sized (5 Gi
 * limit) around this 4 GiB ceiling; change both together.
 *
 * The proxy profile deliberately does not carry these: proxy pods run under a
 * 1536 MiB memory limit (smoke-proxy-memory.sh pins it), and a 4 GiB
 * old-space ceiling would let the heap grow past the cgroup limit and turn GC
 * back-pressure into OOMKills.
 */
export const FULL_PROFILE_V8_FLAGS = ["--max-old-space-size=4096"];

export const PROXY_INCLUDES = [
  // Deliberately omits UNTRACEABLE_WORKER_INCLUDES. The standalone proxy
  // forwards project requests to the production server and never evaluates
  // project config. Its entry graph must therefore remain unable to reach the
  // declarative evaluator worker. compile-binary.test.ts enforces that runtime
  // boundary. If project config evaluation is added to the proxy, embed every
  // reachable worker here and regenerate the proxy lock in the same change.
  //
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

  if (profile === "full") {
    // See FULL_PROFILE_V8_FLAGS: runtime DENO_V8_FLAGS is ignored by compiled
    // binaries, so compile time is the only place the heap limit can be set.
    args.push(`--v8-flags=${FULL_PROFILE_V8_FLAGS.join(",")}`);
  }

  if (profile === "proxy") {
    // Why a dedicated proxy binary exists at all.
    //
    // The universal binary grew from 887,756,293 to 951,154,705 bytes between
    // v0.1.1185 and v0.1.1186, and staging proxy pods began exiting 137
    // (OOMKilled) under their 1536 MiB limit. Renderer pods ran the same binary
    // and survived only because their limit was 4 GiB. Commit 339367a6d
    // ("move asset processors behind explicit extensions") added the Sharp,
    // Lightning CSS, and PurgeCSS includes above; that alone measured about
    // +78 MB of ARM64 artifact and about +234 MB of startup peak memory.
    //
    // A bare `--version` invocation reproduced the OOM before any proxy
    // traffic, Redis, or Sentry work started. That is the load-bearing detail:
    // the cost is Deno mapping the embedded module and dependency archive at
    // startup, not the JavaScript heap. Lowering V8 old-space or disabling
    // Sentry therefore does not help, and raising the memory limit only buys
    // headroom until the next include lands. The fix has to be a smaller
    // embedded graph.
    //
    // So do not "simplify" this branch back onto the workspace lock or the
    // universal include list. The workspace lock contains every framework
    // dependency, and Deno embeds every locked npm package in a compiled
    // binary. Use the graph-specific frozen lock so the proxy carries only its
    // statically anchored providers. Refresh it with
    // `deno task build:proxy-lock` after provider changes.
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

/**
 * Names the worker entries a compiled binary is missing.
 *
 * Every include-list check answers "did we ask for this?", which the binary
 * that crash-looped production would have passed -- it was asked for by nobody
 * and no test noticed. This answers "did it actually ship?", which is the only
 * question whose answer differs between a working and a broken binary.
 *
 * Matches the embedded VFS entry (`"n":"<file>"`) rather than worker body
 * symbols. `dist/framework-src` ships a renamed copy of the same source as a
 * data asset (`...worker-entry.ts.src`), so body symbols appear in a broken
 * binary too and read as a pass. The trailing quote keeps `.ts` from matching
 * `.ts.src`.
 */
export function findMissingEmbeddedWorkers(
  binaryContent: string,
  workerIncludes: readonly string[],
): string[] {
  return workerIncludes.filter((include) =>
    !binaryContent.includes(workerVfsMarker(include))
  );
}

function workerVfsMarker(include: string): string {
  const fileName = include.slice(include.lastIndexOf("/") + 1);
  return `"n":"${fileName}"`;
}

/**
 * Names the V8 flags a compiled binary was NOT built with.
 *
 * Baked flags are serialized into the binary's trailer as a compact JSON
 * array whose tail is the compile invocation's flags, appended after Deno's
 * own defaults (observed on the pinned line:
 * `"v8_flags":["UNUSED_BUT_NECESSARY_ARG0","--stack-size=1024",
 * "--inspector-live-edit","--max-old-space-size=4096"]`). The marker is the
 * joined baked flags plus the array's closing `]` rather than one bare
 * quoted flag, so a future embedded source file or asset that merely
 * contains the quoted literal cannot make this check pass vacuously; the
 * mechanism test's wiring leg verifies the tail anchor against a real
 * compiled artifact, so a Deno release that reordered the trailer would fail
 * loudly there and here, never silently pass. Absence of the marker means
 * the compile invocation dropped the flags and the artifact runs at V8's
 * defaults (veryfront-issue-inbox#269: ~2 GiB instead of the configured
 * 4 GiB). Checked on the artifact rather than by running it because release
 * builds cross-compile targets the CI host cannot execute.
 */
export function findMissingBakedV8Flags(
  binaryContent: string,
  v8Flags: readonly string[],
): string[] {
  if (v8Flags.length === 0) return [];
  return binaryContent.includes(v8FlagsMarker(v8Flags)) ? [] : [...v8Flags];
}

function v8FlagsMarker(v8Flags: readonly string[]): string {
  return `${v8Flags.map((flag) => `"${flag}"`).join(",")}]`;
}

/**
 * Streams the binary looking for each named marker.
 *
 * Reads in chunks rather than decoding the file at once: these binaries embed
 * hundreds of megabytes, and a single decode throws "buffer exceeds maximum
 * length" well before it can check anything. Decodes as latin1 so bytes map to
 * characters one-for-one and the ASCII markers survive arbitrary binary data,
 * and carries the tail of each chunk forward so a marker split across a
 * boundary is still found.
 */
async function findMissingMarkersInFile(
  path: string,
  markers: ReadonlyMap<string, string>,
): Promise<string[]> {
  const CHUNK_BYTES = 8 * 1024 * 1024;
  const carryLength = Math.max(
    ...[...markers.values()].map((marker) => marker.length),
  );

  const remaining = new Map(markers);
  const decoder = new TextDecoder("latin1");
  const buffer = new Uint8Array(CHUNK_BYTES);
  const file = await Deno.open(path, { read: true });

  try {
    let carry = "";
    while (remaining.size > 0) {
      const bytesRead = await file.read(buffer);
      if (bytesRead === null) break;

      const text = carry + decoder.decode(buffer.subarray(0, bytesRead));
      for (const [name, marker] of [...remaining]) {
        if (text.includes(marker)) {
          remaining.delete(name);
        }
      }
      carry = text.slice(-carryLength);
    }
  } finally {
    file.close();
  }

  return [...remaining.keys()];
}

async function assertArtifactContracts(
  outputPath: string,
  profile: CompileBinaryProfile,
): Promise<void> {
  // Expectations come from the declared constants, NOT from the resolved
  // compile args. Deriving them from the args makes this tautological:
  // dropping a worker or flag from the args would also drop it from what is
  // checked, so the one regression this exists to catch would pass. The proxy
  // profile is the sole exemption, for the build reason documented on
  // PROXY_INCLUDES and FULL_PROFILE_V8_FLAGS.
  const expectedWorkers = profile === "proxy" ? [] : UNTRACEABLE_WORKER_INCLUDES;
  const expectedV8Flags = profile === "proxy" ? [] : FULL_PROFILE_V8_FLAGS;
  // All expected flags share the one anchored trailer marker: the compile
  // invocation bakes exactly this set, so either the whole serialized array
  // is present or none of the flags reached the artifact.
  const markers = new Map([
    ...expectedWorkers.map((include) => [include, workerVfsMarker(include)] as const),
    ...expectedV8Flags.map((flag) => [flag, v8FlagsMarker(expectedV8Flags)] as const),
  ]);
  if (markers.size === 0) {
    return;
  }

  const missing = await findMissingMarkersInFile(
    normalizeOutputPath(outputPath),
    markers,
  );
  const missingWorkers = missing.filter((name) => expectedWorkers.includes(name));
  const missingV8Flags = missing.filter((name) => expectedV8Flags.includes(name));

  const failures: string[] = [];
  if (missingWorkers.length > 0) {
    failures.push(
      `Compiled binary is missing ${missingWorkers.length} worker entrypoint(s): ${
        missingWorkers.join(", ")
      }.\nThe binary would start, serve traffic, and crash the first time one is spawned.`,
    );
  }
  if (missingV8Flags.length > 0) {
    failures.push(
      `Compiled binary was not built with V8 flag(s): ${missingV8Flags.join(", ")}.\n` +
        "Compiled binaries ignore DENO_V8_FLAGS at runtime, so without the baked flag " +
        "production runs at V8's ~2 GiB default heap limit and dies there.",
    );
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
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

  await assertArtifactContracts(options.output, options.profile ?? "full");
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
