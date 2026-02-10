#!/usr/bin/env -S deno run --allow-read
/**
 * Barrel JSDoc Linter
 *
 * Warns if any barrel file (index.ts) under src/ is missing a module-level JSDoc comment.
 * Each barrel should have a `@module` tag for documentation purposes.
 *
 * Usage: deno run --allow-read scripts/lint/check-barrel-jsdoc.ts
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const ROOT = "src";

async function main(): Promise<void> {
  const missing: string[] = [];

  for await (const entry of walk(ROOT, {
    match: [/index\.ts$/],
    skip: [/node_modules/, /__tests__/, /\.test\./],
  })) {
    if (!entry.isFile) continue;
    if (!entry.name.match(/^index\.ts$/)) continue;

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
