#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Error Reference Generator
 *
 * Every boundary that reports a VeryfrontError prints a documentation URL built
 * from the error's slug (see src/errors/diagnostic-policy.ts). That URL has to
 * land somewhere real, so the destination page is generated from the same
 * registry the URL is built from — the page cannot drift behind a newly
 * registered error.
 *
 * Usage:
 *   deno task docs:errors         (regenerate docs/guides/errors.md)
 *   deno task docs:errors:check   (fail if the committed page is stale)
 */

import { ERROR_REGISTRY, getAllSlugs } from "../../src/errors/error-registry.ts";
import { ERROR_DOCS_BASE_URL } from "../../src/errors/diagnostic-policy.ts";
import type { ErrorCategory } from "../../src/errors/types.ts";

const CHECK_MODE = Deno.args.includes("--check");

const ROOT = Deno.cwd();
const OUTPUT_PATH = `${ROOT}/docs/guides/errors.md`;

/**
 * Section heading and blurb per category, in the order they appear on the page.
 * Categories are listed explicitly so a new one fails generation loudly rather
 * than silently dropping its errors off the page.
 */
const CATEGORY_SECTIONS: ReadonlyArray<
  { category: ErrorCategory; title: string; blurb: string }
> = [
  {
    category: "CONFIG",
    title: "Configuration",
    blurb: "Raised while loading or validating project configuration.",
  },
  {
    category: "BUILD",
    title: "Build",
    blurb: "Raised while compiling, bundling, or transforming project source.",
  },
  {
    category: "RUNTIME",
    title: "Runtime",
    blurb: "Raised while executing project code.",
  },
  {
    category: "ROUTE",
    title: "Routing",
    blurb: "Raised while matching or handling a route.",
  },
  {
    category: "MODULE",
    title: "Modules",
    blurb: "Raised while resolving or loading a module.",
  },
  {
    category: "SERVER",
    title: "Server",
    blurb: "Raised by the dev server, the request pipeline, or a backing service.",
  },
  {
    category: "BOUNDARY",
    title: "Server and client boundary",
    blurb: "Raised when server-only and client-only code are mixed incorrectly.",
  },
  {
    category: "DEV",
    title: "Development tooling",
    blurb: "Raised by the local development workflow.",
  },
  {
    category: "DEPLOY",
    title: "Deployment",
    blurb: "Raised while building, uploading, or activating a deployment.",
  },
  {
    category: "AGENT",
    title: "Agents",
    blurb: "Raised while running an agent, tool, or workflow.",
  },
  {
    category: "GENERAL",
    title: "General",
    blurb: "Raised anywhere; these are not specific to one subsystem.",
  },
];

interface RegistryEntry {
  slug: string;
  category: ErrorCategory;
  status: number;
  title: string;
  suggestion?: string;
  exitCode?: number;
}

function registryEntries(): RegistryEntry[] {
  const registry = ERROR_REGISTRY as unknown as Record<string, RegistryEntry>;
  return getAllSlugs().map((slug) => registry[slug as string]);
}

/**
 * Escape the characters MDX treats as markup.
 *
 * The published pages are rendered as MDX, so registry text such as
 * "--port <number>" would parse as an unclosed JSX tag and fail the docs
 * build. A backslash escape renders as the literal character in both MDX and
 * plain Markdown.
 */
export function escapeMdxText(value: string): string {
  return value.replace(/[<{]/g, "\\$&");
}

function renderEntry(entry: RegistryEntry): string {
  const lines = [
    `### ${entry.slug}`,
    "",
    `${escapeMdxText(entry.title)}.`,
    "",
    `- **HTTP status:** ${entry.status}`,
  ];
  if (entry.exitCode !== undefined) {
    lines.push(`- **CLI exit code:** ${entry.exitCode}`);
  }
  if (entry.suggestion) {
    lines.push(`- **What to do:** ${escapeMdxText(entry.suggestion)}`);
  }
  return lines.join("\n");
}

function renderPage(): string {
  const entries = registryEntries();
  const known = new Set(CATEGORY_SECTIONS.map((section) => section.category));
  const unknown = entries.filter((entry) => !known.has(entry.category));
  if (unknown.length > 0) {
    const detail = unknown.map((entry) => `${entry.slug} (${entry.category})`).join(", ");
    throw new Error(
      `No page section is defined for these error categories: ${detail}. ` +
        `Add the category to CATEGORY_SECTIONS in ${import.meta.url}.`,
    );
  }

  const blocks: string[] = [
    `---
title: "Error reference"
description: "Every error the Veryfront CLI, server, and logs can report, with what it means and what to do next."
order: 48
---

Veryfront reports errors with a stable slug, such as \`port-in-use\`. The CLI, the
HTTP response body, and the server logs all print that slug alongside a link to
this page, so you can jump straight to the entry for the error you hit.

Each entry lists the HTTP status the error maps to, the process exit code when
it reaches the CLI, and the first thing to try.

This page is generated from the framework's error registry, so it always lists
every error the current release can report.`,
  ];

  for (const section of CATEGORY_SECTIONS) {
    const inSection = entries.filter((entry) => entry.category === section.category);
    if (inSection.length === 0) continue;
    blocks.push(`## ${section.title}\n\n${section.blurb}`);
    for (const entry of inSection) blocks.push(renderEntry(entry));
  }

  return `${blocks.join("\n\n")}\n`;
}

async function formatMarkdown(path: string): Promise<void> {
  const command = new Deno.Command("deno", {
    args: ["fmt", `--config=${ROOT}/deno.json`, path],
    stdout: "null",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    // Silently skipping this would write an unformatted page and, in --check
    // mode, compare against an unformatted expectation -- reporting "current"
    // for a page that fails `deno fmt --check`.
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `deno fmt failed for ${path} (exit code ${output.code})${stderr ? `:\n${stderr}` : ""}`,
    );
  }
}

// Importing this module (the regression test reuses escapeMdxText) must not
// rewrite the committed page, so generation only runs as a program.
if (import.meta.main) await main();

async function main(): Promise<void> {
  const page = renderPage();

  if (CHECK_MODE) {
    const tempPath = await Deno.makeTempFile({
      prefix: "veryfront-error-reference-check-",
      suffix: ".md",
    });
    try {
      await Deno.writeTextFile(tempPath, page);
      await formatMarkdown(tempPath);
      const expected = await Deno.readTextFile(tempPath);
      const committed = await Deno.readTextFile(OUTPUT_PATH).catch(() => null);
      if (committed !== expected) {
        console.error(
          "docs/guides/errors.md is stale. Run `deno task docs:errors` and commit the result.",
        );
        Deno.exit(1);
      }
      console.log(`docs/guides/errors.md is current (${getAllSlugs().length} errors).`);
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
    return;
  }

  await Deno.writeTextFile(OUTPUT_PATH, page);
  await formatMarkdown(OUTPUT_PATH);
  console.log(
    `Wrote docs/guides/errors.md (${getAllSlugs().length} errors, linked from ${ERROR_DOCS_BASE_URL}).`,
  );
}
