#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi
/** Generate the stylesheet compiled into the extension-owned Dev UI bundle. */

import { walk } from "@std/fs/walk";
import { fromFileUrl, relative } from "@std/path";
import { LightningCSSOptimizationEngine } from "../../ext-css-lightning/src/index.ts";
import { TailwindCSSProcessor } from "../../ext-css-tailwind/src/index.ts";
import { extractCandidatesFromFiles } from "../../../src/html/styles-builder/candidate-extractor.ts";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const DEV_UI_SOURCE_ROOT = new URL(
  "extensions/ext-dev-ui-react/src/",
  REPOSITORY_ROOT,
);
const OUTPUT_PATH = new URL(
  "extensions/ext-dev-ui-react/src/dev-ui-styles.generated.ts",
  REPOSITORY_ROOT,
);
const SHELL_SOURCE_PATHS = [
  "src/server/handlers/dev/dashboard/html-shell.ts",
  "src/server/handlers/dev/projects/html-shell.ts",
] as const;
const MAX_SOURCE_FILES = 1_000;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
/**
 * The Dev UI ships to local evergreen browsers only. Every target below
 * understands `oklch()` natively, so Lightning CSS keeps Tailwind's color
 * literals verbatim instead of computing `lab()` fallbacks. That conversion
 * runs platform-dependent floating-point math (libm differs across glibc
 * versions and macOS), which broke byte-exact regeneration between dev
 * machines and CI.
 */
const DEV_UI_BROWSER_QUERIES = [
  "chrome >= 111",
  "edge >= 111",
  "firefox >= 115",
  "safari >= 16.4",
] as const;
const encoder = new TextEncoder();

const STYLESHEET = `@import "tailwindcss";
@theme {
  --font-sans: -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", sans-serif;
  --font-mono: "SF Mono", Monaco, Consolas, monospace;
  --color-vf-bg: #f0efea;
  --color-vf-card: #ffffff;
  --color-vf-border: #ddd9d0;
  --color-vf-text: #1a1a1a;
  --color-vf-muted: #666666;
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #ddd9d0; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #999; }
html[data-veryfront-dev-ui="dashboard"] ::-webkit-scrollbar-thumb {
  background: #e5e7eb;
}
html[data-veryfront-dev-ui="dashboard"] ::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
@keyframes veryfront-dev-ui-spin { to { transform: rotate(360deg); } }
html[data-veryfront-dev-ui="dashboard"] .animate-spin {
  animation: veryfront-dev-ui-spin 0.6s linear infinite;
}
.tabular-nums { font-variant-numeric: tabular-nums; }
`;

async function collectSources(): Promise<
  Array<{ path: string; content: string }>
> {
  const sources: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  const sourceRootPath = fromFileUrl(DEV_UI_SOURCE_ROOT);

  for await (
    const entry of walk(sourceRootPath, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
    })
  ) {
    if (
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx") ||
      entry.name.endsWith(".generated.ts")
    ) {
      continue;
    }
    if (sources.length >= MAX_SOURCE_FILES) {
      throw new RangeError(
        `Development UI exceeds ${MAX_SOURCE_FILES} source files`,
      );
    }
    const content = await Deno.readTextFile(entry.path);
    totalBytes += encoder.encode(content).byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new RangeError(
        `Development UI source exceeds ${MAX_SOURCE_BYTES} bytes`,
      );
    }
    sources.push({ path: relative(sourceRootPath, entry.path), content });
  }

  for (const path of SHELL_SOURCE_PATHS) {
    if (sources.length >= MAX_SOURCE_FILES) {
      throw new RangeError(
        `Development UI exceeds ${MAX_SOURCE_FILES} source files`,
      );
    }
    const content = await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
    totalBytes += encoder.encode(content).byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new RangeError(
        `Development UI source exceeds ${MAX_SOURCE_BYTES} bytes`,
      );
    }
    sources.push({ path, content });
  }

  sources.sort((left, right) => left.path.localeCompare(right.path));
  return sources;
}

async function generateStyles(): Promise<string> {
  const candidates = [...extractCandidatesFromFiles(await collectSources())]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const compiler = await new TailwindCSSProcessor().compile(STYLESHEET);
  const generated = compiler.build(candidates);
  let optimized = new LightningCSSOptimizationEngine({
    browserQueries: DEV_UI_BROWSER_QUERIES,
  }).optimize({
    css: generated,
    sourcePath: "veryfront-dev-ui.css",
    minify: true,
    sourceMap: false,
  }).css.trim();

  while (optimized.startsWith("/*!")) {
    const commentEnd = optimized.indexOf("*/");
    if (commentEnd < 0) {
      throw new TypeError(
        "Development UI stylesheet contains an unterminated license banner",
      );
    }
    optimized = optimized.slice(commentEnd + 2).trimStart();
  }

  const outputBytes = encoder.encode(optimized).byteLength;
  if (outputBytes === 0 || outputBytes > MAX_OUTPUT_BYTES) {
    throw new RangeError(
      `Development UI stylesheet must contain 1-${MAX_OUTPUT_BYTES} bytes`,
    );
  }
  const unsafeToken = optimized.match(
    /<\/style|@import|https?:\/\/|tailwindcss/i,
  )?.[0];
  if (unsafeToken) {
    throw new TypeError(
      `Development UI stylesheet retained external or unsafe token ${JSON.stringify(unsafeToken)}`,
    );
  }
  return optimized;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest).toHex();
}

const checkOnly = Deno.args.length === 1 && Deno.args[0] === "--check";
if (Deno.args.length !== (checkOnly ? 1 : 0)) {
  throw new TypeError("Usage: generate-styles.ts [--check]");
}

const styles = await generateStyles();
const identity = await sha256(styles);
const output = `/**
 * Styles compiled into the extension-owned offline Dev UI bundle.
 *
 * AUTO-GENERATED by extensions/ext-dev-ui-react/scripts/generate-styles.ts.
 * Do not edit manually.
 */

export const DEV_UI_STYLES_SHA256 =
  ${JSON.stringify(identity)} as const;
// deno-fmt-ignore - preserve the generated CSS as one JSON string.
export const DEV_UI_STYLES = ${JSON.stringify(styles)} as const;
`;

if (checkOnly) {
  const existing = await Deno.readTextFile(OUTPUT_PATH).catch(() => null);
  if (existing !== output) {
    const existingIdentity = existing === null
      ? "missing"
      : `${await sha256(existing)} (${existing.length} characters)`;
    if (existing !== null) {
      let divergence = 0;
      const limit = Math.min(existing.length, output.length);
      while (divergence < limit && existing[divergence] === output[divergence]) {
        divergence++;
      }
      const from = Math.max(0, divergence - 80);
      console.error(
        `[ext-dev-ui-react] Styles diverge at character ${divergence}.\n` +
          `computed:   ${JSON.stringify(output.slice(from, divergence + 120))}\n` +
          `checked-in: ${JSON.stringify(existing.slice(from, divergence + 120))}`,
      );
    }
    throw new Error(
      "Extension-owned Dev UI styles are stale; run deno task generate:dev-ui. " +
        `Computed ${await sha256(
          output,
        )} (${output.length} characters) vs checked-in ${existingIdentity}; ` +
        `stylesheet sha256:${identity} (${styles.length} characters).`,
    );
  }
  console.log(
    `[ext-dev-ui-react] Styles are current (${styles.length} characters, sha256:${identity})`,
  );
} else {
  await Deno.writeTextFile(OUTPUT_PATH, output);
  console.log(
    `[ext-dev-ui-react] Wrote ${OUTPUT_PATH.pathname} (${styles.length} characters, sha256:${identity})`,
  );
}
