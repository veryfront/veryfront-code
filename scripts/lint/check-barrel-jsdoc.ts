#!/usr/bin/env -S deno run --allow-read
/**
 * Barrel JSDoc Linter
 *
 * Warns if any top-level public barrel file (src/{module}/index.ts) is missing
 * a module-level JSDoc comment with a `@module` tag. Only the root API surface
 * is checked — nested internal barrels are not required to have one.
 *
 * Usage: deno run --allow-read scripts/lint/check-barrel-jsdoc.ts
 */

import { expandGlob } from "https://deno.land/std@0.224.0/fs/expand_glob.ts";

async function main(): Promise<void> {
  const missing: string[] = [];

  for await (const entry of expandGlob("src/*/index.ts")) {
    if (!entry.isFile) continue;

    const content = await Deno.readTextFile(entry.path);
    const trimmed = content.trimStart();

    const jsdocEnd = trimmed.indexOf("*/");
    if (!trimmed.startsWith("/**") || jsdocEnd === -1 || !trimmed.slice(0, jsdocEnd).includes("@module")) {
      missing.push(entry.path);
    }
  }

  if (missing.length === 0) {
    console.log("All barrel files have module-level JSDoc.");
    Deno.exit(0);
  }

  console.warn(`${missing.length} barrel file(s) missing module-level JSDoc:\n`);
  for (const f of missing) {
    console.warn(`  ${f}`);
  }
  console.warn(
    "\nAdd a module-level JSDoc comment with @module tag to each barrel file.",
  );
  Deno.exit(1);
}

main();
