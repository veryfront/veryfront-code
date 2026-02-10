#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Generate API documentation from top-level barrel files.
 *
 * Runs `deno doc --html` then replaces the index page with a module listing
 * that shows each module name, description, and link to its detail page.
 *
 * Usage: deno task docs
 */

import { expandGlob } from "https://deno.land/std@0.224.0/fs/expand_glob.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";

const ROOT = Deno.cwd();
const DOCS_DIR = `${ROOT}/docs/api`;
const SRC_DIR = `${ROOT}/src`;

interface ModuleInfo {
  name: string;
  description: string;
  href: string;
}

/** Extract the description text (before @module) from a barrel file's JSDoc. */
function extractDescription(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("/**")) return "";

  const end = trimmed.indexOf("*/");
  if (end === -1) return "";

  const block = trimmed.slice(3, end);
  const lines = block.split("\n").map((l) => l.replace(/^\s*\*\s?/, ""));

  // Collect lines before @module or @example
  const descLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@module") || line.startsWith("@example") || line.startsWith("@see")) break;
    descLines.push(line);
  }

  return descLines.join(" ").replace(/\s+/g, " ").trim();
}

async function collectModules(): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  for await (const entry of expandGlob(`${SRC_DIR}/*/index.ts`)) {
    if (!entry.isFile) continue;

    const name = entry.path.replace(`${SRC_DIR}/`, "").replace("/index.ts", "");
    const content = await Deno.readTextFile(entry.path);
    const description = extractDescription(content);

    // Determine the href — deno doc generates either module/index.html or module/index.ts/index.html
    let href = `${name}/index.html`;
    if (!(await exists(`${DOCS_DIR}/${href}`))) {
      href = `${name}/index.ts/index.html`;
    }

    modules.push({ name, description, href });
  }

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

/** Read the generated index.html and extract the shell (head + nav) to reuse. */
async function extractShell(): Promise<{ head: string; navOpen: string; navClose: string }> {
  const original = await Deno.readTextFile(`${DOCS_DIR}/index.html`);

  // Extract <head>...</head> and fix asset paths that may be relative
  const headMatch = original.match(/<head>([\s\S]*?)<\/head>/);
  const head = headMatch ? headMatch[1] : "";

  // Extract the full nav block including search
  const navStart = original.indexOf("<nav id=\"topnav\">");
  const searchResultsEnd = original.indexOf("</div>", original.indexOf("<div id=\"searchResults\">")) + 6;
  const navOpen = original.slice(navStart, searchResultsEnd);

  return { head, navOpen, navClose: "" };
}

/** Count exported symbols from a barrel file (type exports + value exports). */
async function countExports(moduleName: string): Promise<number> {
  const content = await Deno.readTextFile(`${SRC_DIR}/${moduleName}/index.ts`);
  const exportLines = content.match(/^export\s+(?:type\s+)?\{([^}]+)\}/gm) || [];
  let count = 0;
  for (const block of exportLines) {
    const inner = block.match(/\{([^}]+)\}/)?.[1] ?? "";
    count += inner.split(",").filter((s) => s.trim().length > 0).length;
  }
  return count;
}

function generateIndexHTML(
  modules: (ModuleInfo & { exportCount: number })[],
  shell: { head: string; navOpen: string },
): string {
  const moduleItems = modules.map((m) => {
    const badge = m.exportCount > 0
      ? `<span class="module-exports">${m.exportCount} exports</span>`
      : "";
    return `
                <a href="${m.href}" class="module-card">
                  <div class="module-card-header">
                    <div class="module-icon">M</div>
                    <code class="module-name">${m.name}</code>
                    ${badge}
                  </div>
                  <div class="module-desc">${m.description || "&mdash;"}</div>
                </a>`;
  }).join("");

  const extraStyles = `
  <style>
    .module-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 12px;
      max-width: 1200px;
    }
    .module-card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 16px 20px; text-decoration: none;
      border: 1px solid var(--ddoc-selection-border-color-default, #d6d3d1);
      border-radius: 8px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .module-card:hover {
      border-color: var(--ddoc-selection-selected-border-color, #2564eb);
      box-shadow: 0 0 0 1px var(--ddoc-selection-selected-border-color, #2564eb);
    }
    .module-card-header {
      display: flex; align-items: center; gap: 8px;
    }
    .module-icon {
      user-select: none; text-align: center; vertical-align: middle;
      border-radius: 9999px; flex-shrink: 0; width: 1rem; height: 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: .75rem; font-weight: 500; line-height: 1rem;
      color: rgb(210 86 70); background: rgb(210 86 70 / 0.15);
    }
    :is(.dark *) .module-icon {
      color: rgb(229 126 107); background: rgb(229 126 107 / 0.15);
    }
    .module-name {
      font-size: 15px; font-weight: 500;
    }
    .module-exports {
      margin-left: auto; flex-shrink: 0;
      font-size: 11px; line-height: 1;
      padding: 3px 7px; border-radius: 9999px;
      color: rgb(120 113 108); background: rgb(245 245 244);
    }
    :is(.dark *) .module-exports {
      color: rgb(168 162 158); background: rgb(41 37 36);
    }
    .module-desc {
      font-size: 13px; line-height: 1.5;
      color: rgb(87 83 78);
    }
    :is(.dark *) .module-desc {
      color: rgb(168 162 158);
    }
    .index-header { max-width: 1200px; }
    .index-header h1 { margin-bottom: 4px; }
    .index-header p { color: rgb(120 113 108); font-size: 14px; }
    :is(.dark *) .index-header p { color: rgb(168 162 158); }
  </style>`;

  return `<!DOCTYPE html>
<html>
<head>${shell.head}${extraStyles}
</head>
<body>
<div class="ddoc">
<div>${shell.navOpen}<div id="content">
    <main>
      <section>
        <div class="space-y-2 flex-1">
          <div class="space-y-7" id="module_doc">
            <div class="index-header">
              <h1 class="text-2xl font-bold">Modules</h1>
              <p>${modules.length} public API modules</p>
            </div>
            <div class="module-grid">${moduleItems}
            </div>
          </div>
        </div>
      </section>
    </main>
</div>
</div>
</div>
</body>
</html>`;
}

// --- Main ---

console.log("Running deno doc --html ...");
const cmd = new Deno.Command("deno", {
  args: ["doc", "--html", "--output=docs/api", "--name=veryfront", ...Array.from(
    Deno.readDirSync(`${SRC_DIR}`),
  ).filter((e) => e.isDirectory).map((e) => `src/${e.name}/index.ts`).filter((p) => {
    try {
      Deno.statSync(p);
      return true;
    } catch {
      return false;
    }
  })],
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

const { code } = await cmd.output();
if (code !== 0) {
  console.error("deno doc failed");
  Deno.exit(1);
}

console.log("Generating module index ...");
const shell = await extractShell();
const modules = await collectModules();
const enriched = await Promise.all(
  modules.map(async (m) => ({ ...m, exportCount: await countExports(m.name) })),
);
const indexHTML = generateIndexHTML(enriched, shell);
await Deno.writeTextFile(`${DOCS_DIR}/index.html`, indexHTML);
console.log(`Wrote index.html with ${modules.length} modules.`);
