#!/usr/bin/env -S deno run -A
import { walk } from "@std/fs";
import { existsSync } from "@std/fs";

const repoRoot = new URL("../", import.meta.url).pathname;

// Check markdown files in these directories
const dirsToCheck = [
  "src/",
  "examples/",
];

let broken = 0;
let checked = 0;

for (const dir of dirsToCheck) {
  const dirPath = `${repoRoot}${dir}`;
  if (!existsSync(dirPath)) {
    console.log(`Skipping ${dir} (directory not found)`);
    continue;
  }

  for await (const entry of walk(dirPath, { exts: [".md"], includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    // Match markdown links: [text](url) - requires [ before ]
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const href = match[1];
      if (!href) continue;
      // Skip external links
      if (/^https?:\/\//.test(href)) continue;
      if (href.startsWith("#")) continue;
      // Skip links that start with quotes (likely code, not actual links)
      if (href.startsWith("'") || href.startsWith('"')) continue;

      // Resolve relative to current file
      const url = new URL(href.split("#")[0], `file://${entry.path}`);

      try {
        const stat = await Deno.stat(url);
        if (!stat.isFile && !stat.isDirectory) throw new Error("not file or dir");
        checked++;
      } catch {
        console.error(`Broken link in ${entry.path}: ${href}`);
        broken++;
      }
    }
  }
}

if (broken > 0) {
  console.error(`Found ${broken} broken doc link(s)`);
  Deno.exit(1);
} else {
  console.log(`All ${checked} doc links OK`);
}
