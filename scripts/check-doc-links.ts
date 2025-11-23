#!/usr/bin/env -S deno run -A
import { walk } from "std/fs/walk.ts";

const docsRoot = new URL("../docs/", import.meta.url).pathname;
const roots = [docsRoot];

let broken = 0;

for (const root of roots) {
  for await (const entry of walk(root, { exts: [".md"], includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    const re = /\]\(([^)]+)\)/g; // simple markdown link extractor
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const href = match[1];
      if (!href) continue;
      // Skip external links
      if (/^https?:\/\//.test(href)) continue;
      if (href.startsWith("#")) continue;
      // Resolve relative to current file
      const url = new URL(href, `file://${entry.path}`);
      try {
        const stat = await Deno.stat(url);
        if (!stat.isFile && !stat.isDirectory) throw new Error("not file or dir");
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
  console.log("All doc links OK");
}
