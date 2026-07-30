#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi
/** Generate the dependency-free stylesheet embedded by the core development UI. */

import { walk } from "#std/fs/walk";
import { relative } from "#std/path";
import { LightningCSSOptimizationEngine } from "../../extensions/ext-css-lightning/src/index.ts";
import { TailwindCSSProcessor } from "../../extensions/ext-css-tailwind/src/index.ts";
import { extractCandidatesFromFiles } from "../../src/html/styles-builder/candidate-extractor.ts";

const DEV_UI_ROOT = "./src/server/dev-ui";
const OUTPUT_PATH = `${DEV_UI_ROOT}/styles.generated.ts`;
const SHELL_SOURCE_PATHS = [
  "./src/server/handlers/dev/dashboard/html-shell.ts",
  "./src/server/handlers/dev/projects/html-shell.ts",
] as const;
const MAX_SOURCE_FILES = 1_000;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
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
}`;

async function collectSources(): Promise<
  Array<{ path: string; content: string }>
> {
  const sources: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  for await (
    const entry of walk(DEV_UI_ROOT, {
      includeDirs: false,
      exts: [".tsx"],
      followSymlinks: false,
    })
  ) {
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
    sources.push({ path: relative(DEV_UI_ROOT, entry.path), content });
  }
  for (const path of SHELL_SOURCE_PATHS) {
    if (sources.length >= MAX_SOURCE_FILES) {
      throw new RangeError(
        `Development UI exceeds ${MAX_SOURCE_FILES} source files`,
      );
    }
    const content = await Deno.readTextFile(path);
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
    .sort();
  const compiler = await new TailwindCSSProcessor().compile(STYLESHEET);
  const generated = compiler.build(candidates);
  let optimized = new LightningCSSOptimizationEngine().optimize({
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
      `Development UI stylesheet retained external or unsafe token ${
        JSON.stringify(unsafeToken)
      }`,
    );
  }
  return optimized;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function quoteTypeScriptString(value: string): string {
  let quoted = "'";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const character = value[index] ?? "";
    switch (character) {
      case "'":
        quoted += "\\'";
        break;
      case "\\":
        quoted += "\\\\";
        break;
      case "\b":
        quoted += "\\b";
        break;
      case "\f":
        quoted += "\\f";
        break;
      case "\n":
        quoted += "\\n";
        break;
      case "\r":
        quoted += "\\r";
        break;
      case "\t":
        quoted += "\\t";
        break;
      default:
        quoted +=
          codeUnit <= 0x1f || codeUnit === 0x2028 || codeUnit === 0x2029 ||
            codeUnit >= 0xd800 && codeUnit <= 0xdfff
            ? `\\u${codeUnit.toString(16).padStart(4, "0")}`
            : character;
    }
  }
  return `${quoted}'`;
}

const styles = await generateStyles();
const identity = await sha256(styles);
const output =
  `// Generated by scripts/build/generate-dev-ui-styles.ts. Do not edit.\n` +
  `export const DEV_UI_STYLES_SHA256 =\n  ${
    JSON.stringify(identity)
  } as const;\n` +
  `export const DEV_UI_STYLES =\n  ${
    quoteTypeScriptString(styles)
  } as const;\n`;

if (Deno.args.includes("--check")) {
  const existing = await Deno.readTextFile(OUTPUT_PATH).catch(() => null);
  if (existing !== output) {
    console.error(`${OUTPUT_PATH} is stale. Run deno task generate.`);
    Deno.exit(1);
  }
  console.log(
    `${OUTPUT_PATH} is current (${styles.length} characters, sha256 ${identity}).`,
  );
} else {
  await Deno.writeTextFile(OUTPUT_PATH, output);
  console.log(
    `Generated ${OUTPUT_PATH} (${styles.length} characters, sha256 ${identity}).`,
  );
}
